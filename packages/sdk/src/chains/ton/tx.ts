/**
 * TON transaction builders (RN-safe).
 *
 * Vendored from `vultiagent-app/src/services/tonTx.ts` but split into pure
 * primitives that don't reach back into any vault / MPC layer. Callers
 * produce the unsigned BOC, sign it externally (Vultisig's EdDSA MPC or
 * any Ed25519 signer), then call `finalize(sigHex)` to get the signed BOC
 * ready for `broadcastTonTx`.
 *
 * Covered surface:
 *   - `buildTonSendTx`            — native TON transfer (wallet V4R2)
 *   - `buildTonJettonTransferTx`  — Jetton (TRC-20-equivalent) transfer
 *
 * Hermes / crypto.subtle notes: this module imports only from `@ton/core`
 * (peer-dep, pulls `jssha` from `@ton/crypto`, both pure JS) and our own
 * `./walletV4R2` / `./crypto-rn`. It never reaches `@ton/crypto-primitives`
 * so the RN bundle does not need the `crypto.subtle` polyfill.
 */
import type { Cell } from '@ton/core'
import { Address, beginCell, internal, SendMode, storeMessageRelaxed } from '@ton/core'

import { buildV4R2Wallet, storeStateInitCell, TON_V4R2_SUB_WALLET_ID } from './walletV4R2'

// ---------------------------------------------------------------------------
// Hex utils (RN-safe; no Buffer dependency in the hot path)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error(`TON hex input must have even length, got ${clean.length}`)
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0')
  }
  return out
}

// ---------------------------------------------------------------------------
// Address derivation (convenience wrapper)
// ---------------------------------------------------------------------------

/**
 * Derive a user-friendly (EQ.../UQ...) TON address from an Ed25519 pubkey hex.
 * Defaults: workchain=0, non-bounceable, mainnet-flagged.
 */
export function deriveTonAddress(
  publicKeyEd25519Hex: string,
  opts: { workchain?: number; bounceable?: boolean; testOnly?: boolean } = {}
): string {
  const wallet = buildV4R2Wallet({
    publicKeyEd25519: hexToBytes(publicKeyEd25519Hex),
    workchain: opts.workchain,
  })
  return wallet.addressString({ bounceable: opts.bounceable ?? false, testOnly: opts.testOnly })
}

// ---------------------------------------------------------------------------
// Native TON transfer (wallet V4R2)
// ---------------------------------------------------------------------------

export type BuildTonSendOptions = {
  /** Sender's Ed25519 public key, hex (no 0x prefix required). */
  publicKeyEd25519: string
  /** Destination in any TON address format (raw or user-friendly). */
  to: string
  /** Amount in nanotons (1 TON = 10^9 nanotons). */
  amount: bigint
  /** Bounce flag on the inner transfer message. Caller should set this based on wallet-state of the recipient. */
  bounceable: boolean
  /** Optional UTF-8 memo (≤ 123 bytes; longer memos are rejected per TON cell limit). */
  memo?: string
  /** Seqno from `getTonWalletInfo(from).seqno`. First tx = 0. */
  seqno: number
  /** Unix seconds after which the message is invalid. Default = now + 600. */
  validUntil?: number
  /**
   * Sub-wallet ID. Defaults to the V4R2 constant (698983191 for workchain 0).
   * Only override if you're targeting a non-default sub-wallet.
   */
  subWalletId?: number
  /** Sender wallet workchain. Default 0. */
  workchain?: number
}

export type TonTxBuilderResult = {
  /**
   * Hex-encoded signing hash (32 bytes). This is what the EdDSA MPC engine
   * signs. Ed25519 sig over this hash is what goes back into `finalize`.
   */
  signingHashHex: string
  /** Hex-encoded unsigned signing payload BOC, for debug/logging. */
  unsignedBocHex: string
  /**
   * From address (non-bounceable user-friendly form) derived from the pubkey.
   * Handy for UIs that want to show the sender with bounceable=false.
   */
  fromAddress: string
  /**
   * Call once an Ed25519 signature (64 bytes, hex) is available to produce
   * the base64 BOC for `broadcastTonTx`.
   */
  finalize: (signatureHex: string) => {
    signedBocBase64: string
    /**
     * Hash of the external cell (not the signing hash). toncenter returns a
     * different hash on broadcast, so prefer that when available; this one
     * is a local fallback only.
     */
    extMessageHashHex: string
  }
}

function buildSigningPayloadCell(args: {
  subWalletId: number
  validUntil: number
  seqno: number
  innerMsg: Cell
}): Cell {
  // V4R2 signing message layout:
  //   subWalletId(32) || validUntil(32) || seqno(32) || op(8) || sendMode(8) || ref(innerMsg)
  // op=0 for simple order; sendMode = PAY_GAS_SEPARATELY | IGNORE_ERRORS.
  const sendMode = SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS
  return beginCell()
    .storeUint(args.subWalletId, 32)
    .storeUint(args.validUntil, 32)
    .storeUint(args.seqno, 32)
    .storeUint(0, 8)
    .storeUint(sendMode, 8)
    .storeRef(args.innerMsg)
    .endCell()
}

function buildCommentBody(memo: string | undefined): Cell | undefined {
  if (!memo) return undefined
  // Max 123 UTF-8 bytes fit in a single cell slice (1023 bits - 32-bit opcode).
  const encoded = new TextEncoder().encode(memo)
  if (encoded.length > 123) {
    throw new Error(`TON memo exceeds 123 bytes (got ${encoded.length}); reject upstream`)
  }
  // 0x00000000 opcode marks a text comment in the TON convention.
  return beginCell().storeUint(0, 32).storeStringTail(memo).endCell()
}

function buildExternalMessageCell(args: {
  walletAddress: Address
  signature: Uint8Array
  signingPayload: Cell
  includeStateInit: boolean
  stateInitCell?: Cell
}): Cell {
  // ext_in_msg_info$10 src:MsgAddressNone dest:MsgAddressInt import_fee:Grams
  const ext = beginCell()
    .storeUint(0b10, 2)
    .storeUint(0, 2) // src = addr_none
    .storeAddress(args.walletAddress)
    .storeCoins(0) // import_fee

  if (args.includeStateInit) {
    if (!args.stateInitCell) {
      throw new Error('TON external message: includeStateInit requested but no StateInit cell supplied')
    }
    ext.storeBit(true).storeBit(true).storeRef(args.stateInitCell)
  } else {
    ext.storeBit(false)
  }

  // Body is the signed transfer cell (signature || signingPayload slice).
  const bodyCell = beginCell()
    .storeBuffer(Buffer.from(args.signature))
    .storeSlice(args.signingPayload.asSlice())
    .endCell()

  ext.storeBit(true).storeRef(bodyCell)
  return ext.endCell()
}

/**
 * Build an unsigned native TON transfer for wallet V4R2.
 *
 * Signing flow:
 *   1. Call this function with seqno+pubkey+recipient.
 *   2. Pass `result.signingHashHex` to the EdDSA signer (e.g. Vultisig's schnorrSign).
 *   3. Pass the 64-byte Ed25519 signature (hex) to `result.finalize`.
 *   4. Broadcast `signedBocBase64` via `broadcastTonTx`.
 */
export function buildTonSendTx(opts: BuildTonSendOptions): TonTxBuilderResult {
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  const workchain = opts.workchain ?? 0
  const wallet = buildV4R2Wallet({ publicKeyEd25519: pubKey, workchain })
  const destination = Address.parse(opts.to)

  const innerMsg = beginCell()
    .store(
      storeMessageRelaxed(
        internal({
          to: destination,
          value: opts.amount,
          bounce: opts.bounceable,
          body: buildCommentBody(opts.memo),
        })
      )
    )
    .endCell()

  const validUntil = opts.validUntil ?? Math.floor(Date.now() / 1000) + 600
  const subWalletId = opts.subWalletId ?? TON_V4R2_SUB_WALLET_ID + workchain

  const signingPayload = buildSigningPayloadCell({
    subWalletId,
    validUntil,
    seqno: opts.seqno,
    innerMsg,
  })

  const signingHashBytes = signingPayload.hash()
  const signingHashHex = bytesToHex(signingHashBytes)
  const unsignedBocBuf = signingPayload.toBoc({ idx: false })
  const unsignedBocHex = bytesToHex(new Uint8Array(unsignedBocBuf))

  const fromAddress = wallet.addressString({ bounceable: false })
  const stateInitCell = opts.seqno === 0 ? storeStateInitCell(wallet.init) : undefined

  return {
    signingHashHex,
    unsignedBocHex,
    fromAddress,
    finalize: (signatureHex: string) => {
      const signature = hexToBytes(signatureHex)
      if (signature.length !== 64) {
        throw new Error(`TON signature must be 64 bytes (R||S), got ${signature.length}`)
      }
      const ext = buildExternalMessageCell({
        walletAddress: wallet.address,
        signature,
        signingPayload,
        includeStateInit: opts.seqno === 0,
        stateInitCell,
      })
      const signedBocBase64 = ext.toBoc().toString('base64')
      const extMessageHashHex = bytesToHex(ext.hash())
      return { signedBocBase64, extMessageHashHex }
    },
  }
}

// ---------------------------------------------------------------------------
// Jetton transfer (TON's equivalent of ERC-20 / TRC-20)
// ---------------------------------------------------------------------------

const JETTON_TRANSFER_OPCODE = 0xf8a7ea5
/** Standard 0.08 TON gas budget for a Jetton contract call. */
const JETTON_GAS_AMOUNT_NANO = 80000000n
/** 1 nanoton forward amount — the minimum that triggers a transfer_notification. */
const JETTON_FORWARD_AMOUNT_NANO = 1n

export type BuildTonJettonTransferOptions = {
  publicKeyEd25519: string
  /** Recipient's wallet address (where Jettons end up). */
  to: string
  /** Sender's *Jetton wallet* — not the TON wallet. toncenter `/getJettonWalletAddress` resolves this. */
  jettonWalletAddress: string
  /** Amount in Jetton minimal units (use the Jetton metadata's decimals). */
  amount: bigint
  memo?: string
  seqno: number
  validUntil?: number
  subWalletId?: number
  workchain?: number
}

export function buildTonJettonTransferTx(opts: BuildTonJettonTransferOptions): TonTxBuilderResult {
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  const workchain = opts.workchain ?? 0
  const wallet = buildV4R2Wallet({ publicKeyEd25519: pubKey, workchain })

  const destinationAddr = Address.parse(opts.to)
  const jettonWalletAddr = Address.parse(opts.jettonWalletAddress)

  let jettonBody = beginCell()
    .storeUint(JETTON_TRANSFER_OPCODE, 32)
    .storeUint(0, 64) // query_id
    .storeCoins(opts.amount)
    .storeAddress(destinationAddr)
    .storeAddress(wallet.address) // response_destination for excess TON
    .storeBit(false) // no custom_payload
    .storeCoins(JETTON_FORWARD_AMOUNT_NANO)

  if (opts.memo) {
    const commentCell = buildCommentBody(opts.memo)
    if (!commentCell) {
      throw new Error('TON jetton memo: buildCommentBody returned undefined unexpectedly')
    }
    jettonBody = jettonBody.storeBit(true).storeRef(commentCell)
  } else {
    jettonBody = jettonBody.storeBit(false)
  }

  const bodyCell = jettonBody.endCell()

  const innerMsg = beginCell()
    .store(
      storeMessageRelaxed(
        internal({
          to: jettonWalletAddr,
          value: JETTON_GAS_AMOUNT_NANO,
          bounce: true,
          body: bodyCell,
        })
      )
    )
    .endCell()

  const validUntil = opts.validUntil ?? Math.floor(Date.now() / 1000) + 600
  const subWalletId = opts.subWalletId ?? TON_V4R2_SUB_WALLET_ID + workchain

  const signingPayload = buildSigningPayloadCell({
    subWalletId,
    validUntil,
    seqno: opts.seqno,
    innerMsg,
  })

  const signingHashHex = bytesToHex(signingPayload.hash())
  const unsignedBocHex = bytesToHex(new Uint8Array(signingPayload.toBoc({ idx: false })))
  const fromAddress = wallet.addressString({ bounceable: false })
  const stateInitCell = opts.seqno === 0 ? storeStateInitCell(wallet.init) : undefined

  return {
    signingHashHex,
    unsignedBocHex,
    fromAddress,
    finalize: (signatureHex: string) => {
      const signature = hexToBytes(signatureHex)
      if (signature.length !== 64) {
        throw new Error(`TON signature must be 64 bytes (R||S), got ${signature.length}`)
      }
      const ext = buildExternalMessageCell({
        walletAddress: wallet.address,
        signature,
        signingPayload,
        includeStateInit: opts.seqno === 0,
        stateInitCell,
      })
      return {
        signedBocBase64: ext.toBoc().toString('base64'),
        extMessageHashHex: bytesToHex(ext.hash()),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Memo validation helper — useful to surface user errors upstream before
// the tx builder throws mid-encoding.
// ---------------------------------------------------------------------------

/** Throws if `memo` exceeds the 123-byte TON comment cell capacity. */
export function validateTonMemo(memo: string): void {
  const encoded = new TextEncoder().encode(memo)
  if (encoded.length > 123) {
    throw new Error(`TON memo must be at most 123 bytes (got ${encoded.length})`)
  }
}
