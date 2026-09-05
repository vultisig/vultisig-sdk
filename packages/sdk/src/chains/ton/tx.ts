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
 * Hermes / crypto.subtle notes: this module uses `@ton/core` plus
 * WalletCore's generated protobuf namespace to emit parity input. It does not
 * initialize WalletCore WASM and never reaches `@ton/crypto-primitives`, so
 * the RN builder path does not need the `crypto.subtle` polyfill.
 */
import { Address, beginCell, Cell, internal, SendMode, storeMessageRelaxed } from '@ton/core'
import { TW } from '@trustwallet/wallet-core'
import { type TonJettonCommentContext, validateTonComment } from '@vultisig/core-chain/chains/ton/comment'
import type { TonWalletVersion } from '@vultisig/core-chain/chains/ton/wallet'

import { buildV4R2Wallet, storeStateInitCell, TON_V4R2_SUB_WALLET_ID, type TonV4R2Wallet } from './walletV4R2'
import { buildV5R1Wallet, TON_V5R1_WALLET_ID } from './walletV5R1'

// ---------------------------------------------------------------------------
// Hex utils (RN-safe; no Buffer dependency in the hot path)
// ---------------------------------------------------------------------------

/** Decodes a hex string (optionally `0x`-prefixed) into bytes; rejects odd lengths and non-hex characters. */
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

/** Lower-case hex encoding of a byte array. */
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
 * The wallet contract a builder targets. Every existing Vultisig TON account
 * is V4R2; W5 (`v5r1`) is the same key's *other* address and an explicit
 * opt-in — never inferred, because the two hold separate balances.
 */
const defaultWalletVersion: TonWalletVersion = 'v4r2'

/**
 * The wallet view (address + StateInit) for a key under the given contract.
 */
function buildTonWallet(opts: {
  walletVersion: TonWalletVersion
  publicKeyEd25519: Uint8Array
  workchain?: number
  walletId?: number
}): TonV4R2Wallet {
  return opts.walletVersion === 'v5r1' ? buildV5R1Wallet(opts) : buildV4R2Wallet(opts)
}

/**
 * Derive a user-friendly (EQ.../UQ...) TON address from an Ed25519 pubkey hex.
 * Defaults: workchain=0, non-bounceable, mainnet-flagged, wallet V4R2. Pass
 * `walletVersion: 'v5r1'` for the same key's W5 address.
 */
export function deriveTonAddress(
  publicKeyEd25519Hex: string,
  opts: { workchain?: number; bounceable?: boolean; testOnly?: boolean; walletVersion?: TonWalletVersion } = {}
): string {
  const wallet = buildTonWallet({
    walletVersion: opts.walletVersion ?? defaultWalletVersion,
    publicKeyEd25519: hexToBytes(publicKeyEd25519Hex),
    workchain: opts.workchain,
  })
  return wallet.addressString({
    bounceable: opts.bounceable ?? false,
    testOnly: opts.testOnly,
  })
}

// ---------------------------------------------------------------------------
// Native TON transfer (wallet V4R2 or W5)
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
   * Sub-wallet ID. WalletCore 4.7.0 supports one id per contract — 698983191 for
   * V4R2, 2147483409 for W5 — so anything else is rejected: it could not receive
   * an independent parity proof.
   */
  subWalletId?: number
  /** Sender wallet workchain. WalletCore-backed transfers currently support only 0. */
  workchain?: number
  /**
   * Wallet contract to sign for. Defaults to V4R2. `'v5r1'` targets the key's W5
   * wallet, a different address with its own balance — opt in only once funds are
   * there.
   */
  walletVersion?: TonWalletVersion
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
   * Encoded WalletCore TON SigningInput for an independent pre-dispatch
   * signing-hash check. Native and Jetton builders always provide it;
   * arbitrary prebuilt signing payloads cannot be represented by WalletCore
   * and therefore omit it. `fastVaultSign` / `schnorrSign` now require this
   * field for every `chain === 'ton'` sign — a result that omits it (i.e.
   * anything from `buildTonTxFromSigningPayload`) will fail closed at
   * dispatch time rather than reach MPC unchecked.
   */
  walletCoreTxInputData?: Uint8Array
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

export type TonWalletCoreBackedTxBuilderResult = TonTxBuilderResult & {
  walletCoreTxInputData: Uint8Array
}

/**
 * Send mode for an app-initiated TON transfer, in WalletCore's enum.
 *
 * For V4R2, `IGNORE_ACTION_PHASE_ERRORS` (+2) is deliberately absent: with it set, a
 * wallet contract that cannot carry out its outgoing transfer skips the action rather
 * than failing, so the transaction lands un-aborted with the seqno consumed and nothing
 * moved — on chain that is indistinguishable from a real send.
 *
 * W5 has no such choice: its code refuses an external request unless every action
 * carries the flag, because a guaranteed seqno advance is its replay protection, and
 * WalletCore enforces the same rule before it will build the message. The resulting
 * blindness is covered by the status resolver, which reads the action phase.
 *
 * Must stay numerically equal to `getTonCellSendMode` below — the two encode the same
 * field, and any drift between them changes the signing hash.
 */
function getWalletCoreTonSendMode(walletVersion: TonWalletVersion): number {
  const base = TW.TheOpenNetwork.Proto.SendMode.PAY_FEES_SEPARATELY
  return walletVersion === 'v5r1' ? base | TW.TheOpenNetwork.Proto.SendMode.IGNORE_ACTION_PHASE_ERRORS : base
}

/** The same send mode in `@ton/core`'s enum, used when building the signing cell. */
function getTonCellSendMode(walletVersion: TonWalletVersion): number {
  return walletVersion === 'v5r1' ? SendMode.PAY_GAS_SEPARATELY | SendMode.IGNORE_ERRORS : SendMode.PAY_GAS_SEPARATELY
}

const pinnedWalletId: Record<TonWalletVersion, { id: number; label: string }> = {
  v4r2: { id: TON_V4R2_SUB_WALLET_ID, label: 'V4R2 sub-wallet ID' },
  v5r1: { id: TON_V5R1_WALLET_ID, label: 'W5 wallet ID' },
}

/**
 * Narrows caller-supplied wallet options to the only shape these builders can encode.
 * Anything but workchain 0 on the contract's one supported wallet id throws, because the
 * WalletCore parity input emitted alongside the cell cannot represent it and would
 * silently disagree.
 */
function assertWalletCoreTonWalletOptions(opts: {
  subWalletId?: number
  workchain?: number
  walletVersion?: TonWalletVersion
}): {
  subWalletId: number
  workchain: 0
  walletVersion: TonWalletVersion
} {
  const walletVersion = opts.walletVersion ?? defaultWalletVersion
  const workchain = opts.workchain ?? 0
  if (workchain !== 0) {
    throw new Error(`TON WalletCore parity supports only workchain 0, got ${workchain}`)
  }
  const { id: expectedWalletId, label } = pinnedWalletId[walletVersion]
  const subWalletId = opts.subWalletId ?? expectedWalletId
  if (subWalletId !== expectedWalletId) {
    throw new Error(`TON WalletCore parity supports only ${label} ${expectedWalletId}, got ${subWalletId}`)
  }
  return { subWalletId, workchain: 0, walletVersion }
}

/** Big-endian bytes of a non-negative amount, the form WalletCore's TON proto carries amounts in. */
function tonUnsignedIntegerToBytes(field: string, value: bigint): Uint8Array {
  if (value < 0n) {
    throw new Error(`TON ${field} must be a non-negative integer`)
  }
  let hex = value.toString(16)
  if (hex.length % 2 !== 0) hex = `0${hex}`
  return hexToBytes(hex)
}

/**
 * The WalletCore `SigningInput` that mirrors what this builder signs, so a
 * dispatcher can have WalletCore derive the pre-image independently and fail
 * closed if the two disagree.
 */
function encodeWalletCoreTonSigningInput(args: {
  publicKey: Uint8Array
  seqno: number
  validUntil: number
  message: TW.TheOpenNetwork.Proto.ITransfer
  walletVersion: TonWalletVersion
}): Uint8Array {
  const input = TW.TheOpenNetwork.Proto.SigningInput.create({
    walletVersion:
      args.walletVersion === 'v5r1'
        ? TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V5_R1
        : TW.TheOpenNetwork.Proto.WalletVersion.WALLET_V4_R2,
    expireAt: args.validUntil,
    sequenceNumber: args.seqno,
    publicKey: args.publicKey,
    messages: [args.message],
  })
  return TW.TheOpenNetwork.Proto.SigningInput.encode(input).finish()
}

/**
 * The expiry WalletCore stamps on a wallet's first request (seqno 0), for both
 * contracts: `SigningRequestBuilder` replaces the caller's `expire_at` with
 * `u32::MAX` whenever `sequence_number == 0`. The deploying message must not be
 * time-boxed the way a routine send is, and since the value is part of the
 * pre-image, any other choice hashes differently from every co-signer.
 */
const STATE_INIT_EXPIRE_AT = 0xffffffff

/** The expiry that goes into the signed request: the caller's, except on a first send. */
function effectiveValidUntil(seqno: number, validUntil: number | undefined): number {
  return seqno === 0 ? STATE_INIT_EXPIRE_AT : (validUntil ?? Math.floor(Date.now() / 1000) + 600)
}

/** W5 `signed_external` request opcode. */
const W5_SIGNED_EXTERNAL_OPCODE = 0x7369676e
/** W5 `action_send_msg` opcode. */
const W5_ACTION_SEND_MSG_OPCODE = 0x0ec3c86d

/**
 * Builds the cell that gets signed. This is the preimage every co-signer hashes, so
 * field order, bit widths and the send mode must match WalletCore's encoder exactly.
 *
 * V4R2:
 *   subWalletId(32) || validUntil(32) || seqno(32) || op(8)=0 || sendMode(8) || ref(innerMsg)
 *
 * W5 (`signed_external`, signature appended by `buildExternalMessageCell`):
 *   0x7369676e(32) || walletId(int32) || validUntil(32) || seqno(32) || 1 || ref(outList) || 0
 * where the single action is `action_send_msg#0ec3c86d mode(8)` with refs
 * [prev = empty list, innerMsg] — the shape WalletCore builds for one message.
 */
function buildSigningPayloadCell(args: {
  walletVersion: TonWalletVersion
  subWalletId: number
  validUntil: number
  seqno: number
  innerMsg: Cell
}): Cell {
  if (args.walletVersion === 'v5r1') {
    const outList = beginCell()
      .storeUint(W5_ACTION_SEND_MSG_OPCODE, 32)
      .storeUint(getTonCellSendMode('v5r1'), 8)
      .storeRef(beginCell().endCell())
      .storeRef(args.innerMsg)
      .endCell()
    return beginCell()
      .storeUint(W5_SIGNED_EXTERNAL_OPCODE, 32)
      .storeInt(args.subWalletId, 32)
      .storeUint(args.validUntil, 32)
      .storeUint(args.seqno, 32)
      .storeBit(true)
      .storeRef(outList)
      .storeBit(false)
      .endCell()
  }
  return beginCell()
    .storeUint(args.subWalletId, 32)
    .storeUint(args.validUntil, 32)
    .storeUint(args.seqno, 32)
    .storeUint(0, 8)
    .storeUint(getTonCellSendMode('v4r2'), 8)
    .storeRef(args.innerMsg)
    .endCell()
}

/**
 * The text-comment body cell for a native transfer: 32-bit zero opcode then the
 * UTF-8 memo. Returns `undefined` for an empty memo so the caller can omit the
 * body entirely; throws if the memo will not fit the cell.
 */
function buildCommentBody(memo: string | undefined): Cell | undefined {
  if (!memo) return undefined
  // Native cap only. A jetton comment shares its cell with the transfer fields
  // and gets a smaller, amount-dependent budget, which the jetton builder
  // checks against the body it is actually filling.
  validateTonComment({ memo })
  // 0x00000000 opcode marks a text comment in the TON convention.
  return beginCell().storeUint(0, 32).storeStringTail(memo).endCell()
}

/**
 * Wraps the signed request in the external message the network accepts:
 * `ext_in_msg_info` addressed to the wallet, the StateInit when this is the
 * deploying first send, and the body carrying the request plus signature in the
 * contract's order.
 */
function buildExternalMessageCell(args: {
  walletVersion: TonWalletVersion
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

  // Body is the signed request. V4R2 puts the signature first; W5's
  // `signed_external` puts it last, after the request it covers.
  const bodyCell =
    args.walletVersion === 'v5r1'
      ? beginCell().storeSlice(args.signingPayload.asSlice()).storeBuffer(Buffer.from(args.signature)).endCell()
      : beginCell().storeBuffer(Buffer.from(args.signature)).storeSlice(args.signingPayload.asSlice()).endCell()

  ext.storeBit(true).storeRef(bodyCell)
  return ext.endCell()
}

/**
 * Build an unsigned native TON transfer for wallet V4R2.
 *
 * Signing flow:
 *   1. Call this function with seqno+pubkey+recipient.
 *   2. When using `fastVaultSign`, pass both `result.signingHashHex` and
 *      `result.walletCoreTxInputData`; the latter lets the signer fail closed
 *      if WalletCore derives a different hash.
 *   3. Pass the 64-byte Ed25519 signature (hex) to `result.finalize`.
 *   4. Broadcast `signedBocBase64` via `broadcastTonTx`.
 */
export function buildTonSendTx(opts: BuildTonSendOptions): TonWalletCoreBackedTxBuilderResult {
  const { subWalletId, workchain, walletVersion } = assertWalletCoreTonWalletOptions(opts)
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  const wallet = buildTonWallet({ walletVersion, publicKeyEd25519: pubKey, workchain, walletId: subWalletId })
  const destination = Address.parse(opts.to)

  const innerMsg = beginCell()
    .store(
      storeMessageRelaxed(
        internal({
          to: destination,
          value: opts.amount,
          bounce: opts.bounceable,
          body: buildCommentBody(opts.memo),
        }),
        // WalletCore always stores the internal-message body as a reference.
        // @ton/core otherwise inlines small bodies, which is semantically
        // equivalent on-chain but produces a different signing-payload hash.
        { forceRef: true }
      )
    )
    .endCell()

  const validUntil = effectiveValidUntil(opts.seqno, opts.validUntil)
  const signingPayload = buildSigningPayloadCell({
    walletVersion,
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
  const walletCoreTxInputData = encodeWalletCoreTonSigningInput({
    walletVersion,
    publicKey: pubKey,
    seqno: opts.seqno,
    validUntil,
    message: TW.TheOpenNetwork.Proto.Transfer.create({
      dest: opts.to,
      amount: tonUnsignedIntegerToBytes('amount', opts.amount),
      mode: getWalletCoreTonSendMode(walletVersion),
      comment: opts.memo ?? '',
      bounceable: opts.bounceable,
    }),
  })

  return {
    signingHashHex,
    unsignedBocHex,
    fromAddress,
    walletCoreTxInputData,
    finalize: (signatureHex: string) => {
      const signature = hexToBytes(signatureHex)
      if (signature.length !== 64) {
        throw new Error(`TON signature must be 64 bytes (R||S), got ${signature.length}`)
      }
      const ext = buildExternalMessageCell({
        walletVersion,
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
  /** Whether the recipient account is initialized. Matches WalletCore's transfer context; defaults to true. */
  isActiveDestination?: boolean
  /** Optional UTF-8 comment; must fit WalletCore's inline Jetton forward_payload. The cap shrinks as `amount` grows (larger VarUInteger encoding leaves fewer bits) — at most ~34 ASCII bytes for large amounts, ~39 for small ones. Throws if it doesn't fit. */
  memo?: string
  seqno: number
  validUntil?: number
  /** WalletCore 4.7.0 supports one id per contract: 698983191 for V4R2, 2147483409 for W5. */
  subWalletId?: number
  /** WalletCore-backed transfers currently support only workchain 0. */
  workchain?: number
  /** Wallet contract to sign for. Defaults to V4R2; `'v5r1'` is the key's separate W5 account. */
  walletVersion?: TonWalletVersion
}

/**
 * Build an unsigned Jetton transfer: an internal message to the sender's own
 * Jetton wallet carrying the TEP-74 `transfer` body, wrapped in the wallet
 * contract's request. Same signing flow and result contract as `buildTonSendTx`.
 */
export function buildTonJettonTransferTx(opts: BuildTonJettonTransferOptions): TonWalletCoreBackedTxBuilderResult {
  const { subWalletId, workchain, walletVersion } = assertWalletCoreTonWalletOptions(opts)
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  const wallet = buildTonWallet({ walletVersion, publicKeyEd25519: pubKey, workchain, walletId: subWalletId })

  const destinationAddr = Address.parse(opts.to)
  const jettonWalletAddr = Address.parse(opts.jettonWalletAddress)

  let jettonBody = beginCell()
    .storeUint(JETTON_TRANSFER_OPCODE, 32)
    .storeUint(0, 64) // query_id
    .storeCoins(opts.amount)
    .storeAddress(destinationAddr)
    .storeAddress(wallet.address) // response_destination for excess TON
    .storeBit(false) // no custom_payload
    .storeCoins((opts.isActiveDestination ?? true) ? JETTON_FORWARD_AMOUNT_NANO : 0n)

  if (opts.memo) {
    const commentCell = buildCommentBody(opts.memo)
    if (!commentCell) {
      throw new Error('TON jetton memo: buildCommentBody returned undefined unexpectedly')
    }
    // WalletCore only supports the inline Either Cell representation here.
    // Its remaining capacity varies with the already-encoded Jetton fields.
    if (commentCell.bits.length + 1 > jettonBody.availableBits) {
      throw new Error(
        `TON jetton memo exceeds WalletCore inline forward_payload capacity (${commentCell.bits.length} bits, ${jettonBody.availableBits - 1} available)`
      )
    }
    jettonBody = jettonBody.storeBit(false).storeSlice(commentCell.beginParse())
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
        }),
        // Match WalletCore's canonical cell shape for mixed-platform MPC.
        { forceRef: true }
      )
    )
    .endCell()

  const validUntil = effectiveValidUntil(opts.seqno, opts.validUntil)
  const signingPayload = buildSigningPayloadCell({
    walletVersion,
    subWalletId,
    validUntil,
    seqno: opts.seqno,
    innerMsg,
  })

  const signingHashHex = bytesToHex(signingPayload.hash())
  const unsignedBocHex = bytesToHex(new Uint8Array(signingPayload.toBoc({ idx: false })))
  const fromAddress = wallet.addressString({ bounceable: false })
  const stateInitCell = opts.seqno === 0 ? storeStateInitCell(wallet.init) : undefined
  const walletCoreTxInputData = encodeWalletCoreTonSigningInput({
    walletVersion,
    publicKey: pubKey,
    seqno: opts.seqno,
    validUntil,
    message: TW.TheOpenNetwork.Proto.Transfer.create({
      dest: opts.jettonWalletAddress,
      amount: tonUnsignedIntegerToBytes('Jetton gas amount', JETTON_GAS_AMOUNT_NANO),
      mode: getWalletCoreTonSendMode(walletVersion),
      comment: opts.memo ?? '',
      bounceable: true,
      jettonTransfer: TW.TheOpenNetwork.Proto.JettonTransfer.create({
        jettonAmount: tonUnsignedIntegerToBytes('Jetton amount', opts.amount),
        toOwner: destinationAddr.toString({ bounceable: true, testOnly: false }),
        responseAddress: fromAddress,
        forwardAmount: tonUnsignedIntegerToBytes(
          'Jetton forward amount',
          (opts.isActiveDestination ?? true) ? JETTON_FORWARD_AMOUNT_NANO : 0n
        ),
      }),
    }),
  })

  return {
    signingHashHex,
    unsignedBocHex,
    fromAddress,
    walletCoreTxInputData,
    finalize: (signatureHex: string) => {
      const signature = hexToBytes(signatureHex)
      if (signature.length !== 64) {
        throw new Error(`TON signature must be 64 bytes (R||S), got ${signature.length}`)
      }
      const ext = buildExternalMessageCell({
        walletVersion,
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
  /**
   * Wallet contract the payload was built for. Defaults to V4R2. It decides
   * the envelope's sender address, the StateInit attached on a first send,
   * and where the signature goes — V4R2 prefixes it, W5 appends it — so a
   * payload built for one contract must not be finalized as the other.
   */
  walletVersion?: TonWalletVersion
}

/** Parses a caller-supplied signing-payload BoC given as base64 or (optionally `0x`-prefixed) hex. */
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
 *
 * IMPORTANT: this result never carries `walletCoreTxInputData` — an opaque
 * prebuilt payload's inner message can encode an arbitrary contract call
 * (e.g. a yield.xyz staking-pool invocation), so it cannot be reliably
 * reconstructed into a WalletCore `Transfer` for independent parity proof.
 * `fastVaultSign` / `schnorrSign` require that field for every TON sign, so
 * a caller that goes `buildTonTxFromSigningPayload(...) -> schnorrSign(...)`
 * will now get a `MissingSigningParityInput` rejection instead of reaching
 * MPC. There is currently no supported way to sign a prebuilt TON payload
 * through the fast-sign path in this SDK version.
 */
export function buildTonTxFromSigningPayload(opts: BuildTonTxFromSigningPayloadOptions): TonTxBuilderResult {
  const pubKey = hexToBytes(opts.publicKeyEd25519)
  if (pubKey.length !== 32) {
    throw new Error(`TON publicKeyEd25519 must be 32 bytes, got ${pubKey.length}`)
  }
  const workchain = opts.workchain ?? 0
  const walletVersion = opts.walletVersion ?? defaultWalletVersion
  const wallet = buildTonWallet({ walletVersion, publicKeyEd25519: pubKey, workchain })

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
        walletVersion,
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

/**
 * Throws if `memo` will not fit the cell it is destined for.
 *
 * Pass `jetton` for a Jetton transfer: its comment rides inline in the transfer
 * body's `forward_payload`, so the cap is far below the native 123 bytes and
 * shrinks as the amount grows. Without it the native cap applies.
 */
export function validateTonMemo(memo: string, jetton?: TonJettonCommentContext): void {
  validateTonComment({ memo, jetton })
}
