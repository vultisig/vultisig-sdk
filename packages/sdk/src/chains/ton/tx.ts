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
import { Address, beginCell, Cell, internal, SendMode, storeMessageRelaxed } from '@ton/core'

import { buildV4R2Wallet, storeStateInitCell, TON_V4R2_SUB_WALLET_ID } from './walletV4R2'

// ---------------------------------------------------------------------------
// Hex utils (RN-safe; no Buffer dependency in the hot path)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error(`TON hex input must have even length, got ${clean.length}`)
  }
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error(`TON hex input contains non-hex characters: ${clean}`)
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
  return wallet.addressString({
    bounceable: opts.bounceable ?? false,
    testOnly: opts.testOnly,
  })
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
// Prebuilt-signing-payload primitive
//
// `buildTonTxFromSigningPayload` accepts a pre-built signing-payload BoC
// (the inner Cell that gets hashed for signing) plus the user's pubkey,
// returns the same {signingHashHex, finalize} contract as the
// chain-specific builders. Used by:
//
//   - yield.xyz TON staking actions (tston-staking, nomination-staking,
//     chorus-one-pools-staking) which return the signing-payload BoC
//     pre-encoded — we'd otherwise need to ship a builder per pool
//     contract variant.
//
//   - WalletConnect / dApp signing flows where the dApp constructs the
//     payload server-side.
//
// ## Seqno freshness — critical
//
// TON wallets reject any external message whose embedded seqno doesn't
// match the wallet contract's CURRENT seqno (the wallet's nonce). yield.xyz
// pins the seqno at action-create time; if the user takes >30s to sign,
// the seqno is stale and the broadcast fails with `external message was
// not accepted`.
//
// This primitive does NOT re-pin the seqno — it signs whatever payload
// it's given, deterministically. The consumer (app's signing flow) is
// responsible for either:
//   (a) regenerating the payload with a fresh seqno right before signing
//       (recommended for yield.xyz-style integrations), OR
//   (b) accepting the risk of seqno-stale failures with a clear user
//       message when broadcast 4xxs.
//
// Surfacing both options keeps the primitive pure — re-pinning would
// mean parsing the BoC, mutating the seqno cell, and re-hashing, which
// is a different abstraction.
// ---------------------------------------------------------------------------

export type BuildTonTxFromSigningPayloadOptions = {
  /**
   * Ed25519 pubkey of the signer (32 bytes, hex). Used to derive the
   * V4R2 wallet address for the outer external-message envelope —
   * NOT included in the signed payload itself. The signing hash is
   * the hash of the payload BoC; the pubkey only affects the envelope
   * `dest:MsgAddressInt` field.
   */
  publicKeyEd25519: string
  /**
   * The pre-built signing-payload BoC, base64-encoded. yield.xyz returns
   * this verbatim in each step's `unsignedTransaction` field. Hex is
   * also accepted (auto-detect by prefix / character set) so a future
   * upstream that emits hex doesn't break this primitive.
   */
  signingPayloadBoc: string
  /**
   * When true, the external message wraps a StateInit cell (the wallet
   * deploys itself in the same tx). Required for the very first send
   * from a wallet — the contract isn't on-chain yet so the message
   * must include code+data.
   *
   * For TON V4R2 the rule is: include StateInit iff seqno === 0. Callers
   * that derive the BoC from yield.xyz typically know this from their
   * own seqno lookup; pass true on first-ever send, false otherwise.
   *
   * Default false to fail-closed (a missing StateInit on first send
   * surfaces as a clear broadcast error; a stale StateInit on a later
   * send would pass an invalid contract redeploy).
   */
  includeStateInit?: boolean
  /**
   * Optional override for the wallet workchain. Defaults to `0` (the
   * basechain — where all user wallets live). Pass `-1` for the
   * masterchain (validators / system contracts); almost no consumer
   * needs this.
   */
  workchain?: number
}

function decodeSigningPayload(input: string): Cell {
  // Encoding detection (CodeRabbit #516 R2). The serialized BoC arrives
  // as either hex or base64, and yield.xyz uses both depending on the
  // protocol family. Two refinements over the naive "any-even-hex →
  // hex" check:
  //
  //   1. Accept an optional `0x`/`0X` prefix on hex input. Without
  //      this, a callsite that prefixes (common in EVM-leaning
  //      tooling) would silently fall through to the base64 branch
  //      and produce wrong bytes.
  //
  //   2. Disambiguate hex vs base64 when both regexes would match.
  //      A hex string like "abcdef0123456789" is *also* valid
  //      base64. We prefer hex when EITHER:
  //        - the input starts with `0x`/`0X`, OR
  //        - the input is even-length, every char is in [0-9a-fA-F]
  //          AND it cannot also be the start of a base64-encoded BoC.
  //      A real BoC always begins with the magic byte 0xB5
  //      (`B5EE9C72…` in hex). When we see that magic, treat it as
  //      hex even if the rest could parse as base64.
  //
  // Anything else → base64. Buffer.from(_, 'base64') silently drops
  // non-base64 characters, so we sanity-check by ensuring the
  // produced byte stream re-parses as a valid BoC below; the
  // Cell.fromBoc + zero-cells guards downstream catch corruption.
  const trimmed = input.trim()
  if (trimmed.length === 0) {
    throw new Error('TON signing payload BoC is empty')
  }
  const hadHexPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X')
  const normalized = hadHexPrefix ? trimmed.slice(2) : trimmed
  const isEvenHex = normalized.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(normalized)
  // BoC magic 0xB5EE9C72 (4 bytes = 8 hex chars). If the input is hex
  // AND begins with that prefix, it's unambiguously hex.
  const startsWithBocMagic = isEvenHex && /^b5ee9c72/i.test(normalized)
  // Prefer hex when:
  //  - caller explicitly prefixed with 0x, OR
  //  - input matches the BoC magic in hex, OR
  //  - input is even-length hex AND cannot also be parsed as base64
  //    (length not multiple of 4 → base64 padding can't fit).
  const couldBeBase64 = /^[A-Za-z0-9+/]+={0,2}$/.test(normalized) && normalized.length % 4 === 0
  const looksLikeHex = hadHexPrefix || startsWithBocMagic || (isEvenHex && !couldBeBase64)
  const bocBytes = looksLikeHex ? hexToBytes(normalized) : new Uint8Array(Buffer.from(normalized, 'base64'))

  const cells = Cell.fromBoc(Buffer.from(bocBytes))
  if (cells.length === 0) {
    throw new Error('TON signing payload BoC contained zero cells')
  }
  const first = cells[0]
  if (!first) {
    throw new Error('TON signing payload BoC root cell missing')
  }
  return first
}

/**
 * Sign a pre-built TON signing payload (the inner Cell that gets hashed
 * for the wallet's external-message body). See the section header
 * comment above for the full design rationale and seqno-freshness
 * warnings.
 *
 * @returns {signingHashHex, unsignedBocHex, fromAddress, finalize(sig)}
 *          — identical contract to `buildTonSendTx` so call-sites can
 *          treat both paths uniformly. `unsignedBocHex` round-trips
 *          the decoded payload's serialized form (NOT the input
 *          string verbatim — equality holds at the byte level after
 *          BoC re-serialization).
 */
export function buildTonTxFromSigningPayload(opts: BuildTonTxFromSigningPayloadOptions): TonTxBuilderResult {
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  if (pubKey.length !== 32) {
    throw new Error(`TON publicKeyEd25519 must be 32 bytes, got ${pubKey.length}`)
  }
  const workchain = opts.workchain ?? 0
  const wallet = buildV4R2Wallet({ publicKeyEd25519: pubKey, workchain })

  const signingPayload = decodeSigningPayload(opts.signingPayloadBoc)

  const signingHashBytes = signingPayload.hash()
  const signingHashHex = bytesToHex(signingHashBytes)
  const unsignedBocBuf = signingPayload.toBoc({ idx: false })
  const unsignedBocHex = bytesToHex(new Uint8Array(unsignedBocBuf))

  const fromAddress = wallet.addressString({ bounceable: false })
  const includeStateInit = opts.includeStateInit ?? false
  const stateInitCell = includeStateInit ? storeStateInitCell(wallet.init) : undefined

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
        includeStateInit,
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
