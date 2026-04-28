/**
 * Cosmos-family transaction encoding primitives (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/cosmosTx.ts. Exposes:
 *   - `deriveCosmosAddress(pubKeyHex, chainCode, hrp, slip44)` — bech32
 *     address derivation using @noble/curves/secp256k1 (no WalletCore).
 *   - `buildCosmosSendTx(opts)` — returns a pre-signed payload with the
 *     signing hash consumers must pass to fastVaultSign, plus a finalize
 *     callback that produces the broadcastable TxRaw once the signature
 *     hex is available.
 *   - `buildCosmosWasmExecuteTx(opts)` — same shape for MsgExecuteContract
 *     (CW-20 transfers, WASM contract calls).
 *   - `buildThorchainDepositTx(opts)` — THORChain MsgDeposit for LP ops.
 *
 * The broadcast step stays with the consumer because it needs `fetch` with
 * the correct RPC URL, which the consumer passes in explicitly (or pulls
 * from configureRuntime()).
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hmac } from '@noble/hashes/hmac.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bech32 } from '@scure/base'

// ---------------------------------------------------------------------------
// Hex utils (RN-safe, no Buffer)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error(`hexToBytes: odd-length hex string (${clean.length} chars)`)
  }
  if (clean.length > 0 && !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('hexToBytes: non-hex characters in input')
  }
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------------------
// Address derivation (Cosmos bech32 from ECDSA pubkey + optional BIP32 path)
// ---------------------------------------------------------------------------

export function deriveCosmosAddress(
  compressedPubKeyHex: string,
  hexChainCode: string,
  hrp: string,
  slip44: number
): string {
  let pubKeyBytes = hexToBytes(compressedPubKeyHex)

  if (hexChainCode && hexChainCode.length > 0) {
    let chainCode = hexToBytes(hexChainCode)
    const path = [44, slip44, 0, 0, 0]
    for (const index of path) {
      const data = new Uint8Array(37)
      data.set(pubKeyBytes, 0)
      data[33] = (index >>> 24) & 0xff
      data[34] = (index >>> 16) & 0xff
      data[35] = (index >>> 8) & 0xff
      data[36] = index & 0xff
      const I = hmac(sha512, chainCode, data)
      const IL = I.slice(0, 32)
      const IR = I.slice(32)
      const parentPoint = secp256k1.Point.fromHex(bytesToHex(pubKeyBytes))
      const tweakBigInt = BigInt('0x' + bytesToHex(IL))
      const tweakPoint = secp256k1.Point.BASE.multiply(tweakBigInt)
      const childPoint = parentPoint.add(tweakPoint)
      pubKeyBytes = childPoint.toBytes(true)
      chainCode = IR
    }
  }

  const sha = sha256(pubKeyBytes)
  const ripe = ripemd160(sha)
  return bech32.encode(hrp, bech32.toWords(ripe))
}

/**
 * Derive the per-chain compressed pubkey used inside Cosmos SignerInfo.
 * Applies a 5-hop BIP32 path `m/44/slip44/0/0/0` — the same path as
 * deriveCosmosAddress. Returned bytes are the 33-byte compressed form.
 */
export function deriveCosmosPubkey(compressedPubKeyHex: string, hexChainCode: string, slip44: number): Uint8Array {
  let pubKeyBytes = hexToBytes(compressedPubKeyHex)
  if (!hexChainCode || hexChainCode.length === 0) return pubKeyBytes
  let chainCode = hexToBytes(hexChainCode)
  for (const index of [44, slip44, 0, 0, 0]) {
    const data = new Uint8Array(37)
    data.set(pubKeyBytes, 0)
    data[33] = (index >>> 24) & 0xff
    data[34] = (index >>> 16) & 0xff
    data[35] = (index >>> 8) & 0xff
    data[36] = index & 0xff
    const I = hmac(sha512, chainCode, data)
    const IL = I.slice(0, 32)
    const IR = I.slice(32)
    const parentPoint = secp256k1.Point.fromHex(bytesToHex(pubKeyBytes))
    const tweakBigInt = BigInt('0x' + bytesToHex(IL))
    const tweakPoint = secp256k1.Point.BASE.multiply(tweakBigInt)
    const childPoint = parentPoint.add(tweakPoint)
    pubKeyBytes = childPoint.toBytes(true)
    chainCode = IR
  }
  return pubKeyBytes
}

// ---------------------------------------------------------------------------
// Protobuf helpers (minimal varint + length-delimited encoding)
// ---------------------------------------------------------------------------

// Exported for unit tests so the bound-check (CR item #7) can be exercised
// directly. Not part of the public SDK surface — naming convention matches
// other test-only exports in the SDK.
export function varintForTesting(n: number): Uint8Array {
  return varint(n)
}

function varint(n: number): Uint8Array {
  // Bound-check: `>>>=` operates on 32-bit unsigned integers, so any value
  // above 2^32-1 silently wraps and we emit a varint that decodes to a
  // different number than `n`. Every call-site here is `field-number << 3 |
  // wireType` (≤ 2^7) or a length prefix derived from `Uint8Array.length`
  // (capped at 2^32-1 in practice), but we still guard the boundary so a
  // future caller passing a JS-`number` that came from BigInt arithmetic
  // can't silently corrupt the protobuf body. We also reject non-integers
  // and negatives — both produce nonsense varints.
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`varint: value out of range (got ${n})`)
  }
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n & 0x7f)
  return new Uint8Array(bytes)
}

function field(fieldNum: number, wireType: number, data: Uint8Array): Uint8Array {
  const tag = varint((fieldNum << 3) | wireType)
  if (wireType === 2) {
    const len = varint(data.length)
    const result = new Uint8Array(tag.length + len.length + data.length)
    result.set(tag, 0)
    result.set(len, tag.length)
    result.set(data, tag.length + len.length)
    return result
  }
  const result = new Uint8Array(tag.length + data.length)
  result.set(tag, 0)
  result.set(data, tag.length)
  return result
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function encodeString(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function encodeCoin(denom: string, amount: string): Uint8Array {
  return concat(field(1, 2, encodeString(denom)), field(2, 2, encodeString(amount)))
}

function wrapAny(typeUrl: string, value: Uint8Array): Uint8Array {
  return concat(field(1, 2, encodeString(typeUrl)), field(2, 2, value))
}

// ---------------------------------------------------------------------------
// Message builders
// ---------------------------------------------------------------------------

function buildBankMsgSend(fromAddress: string, toAddress: string, amount: string, denom: string): Uint8Array {
  return concat(
    field(1, 2, encodeString(fromAddress)),
    field(2, 2, encodeString(toAddress)),
    field(3, 2, encodeCoin(denom, amount))
  )
}

function buildThorMsgSend(fromAddress: string, toAddress: string, amount: string, denom: string): Uint8Array {
  const fromBytes = new Uint8Array(bech32.fromWords(bech32.decode(fromAddress as `${string}1${string}`).words))
  const toBytes = new Uint8Array(bech32.fromWords(bech32.decode(toAddress as `${string}1${string}`).words))
  return concat(field(1, 2, fromBytes), field(2, 2, toBytes), field(3, 2, encodeCoin(denom, amount)))
}

function buildThorMsgDeposit(signerAddress: string, runeAmountBaseUnits: string, memo: string): Uint8Array {
  const signerBytes = new Uint8Array(bech32.fromWords(bech32.decode(signerAddress as `${string}1${string}`).words))
  const runeAsset = concat(
    field(1, 2, encodeString('THOR')),
    field(2, 2, encodeString('RUNE')),
    field(3, 2, encodeString('RUNE'))
  )
  const runeCoin = concat(field(1, 2, runeAsset), field(2, 2, encodeString(runeAmountBaseUnits)))
  return concat(field(1, 2, runeCoin), field(2, 2, encodeString(memo)), field(3, 2, signerBytes))
}

function buildMsgExecuteContract(
  sender: string,
  contract: string,
  msgJson: string,
  funds: Array<{ denom: string; amount: string }> = []
): Uint8Array {
  const parts: Uint8Array[] = [
    field(1, 2, encodeString(sender)),
    field(2, 2, encodeString(contract)),
    field(3, 2, encodeString(msgJson)),
  ]
  for (const c of funds) parts.push(field(5, 2, encodeCoin(c.denom, c.amount)))
  return concat(...parts)
}

// cosmos.staking.v1beta1.MsgDelegate (also identical wire format to MsgUndelegate)
//   string delegator_address = 1;
//   string validator_address = 2;
//   cosmos.base.v1beta1.Coin amount = 3;
function buildMsgDelegateOrUndelegate(
  delegatorAddress: string,
  validatorAddress: string,
  amount: string,
  denom: string
): Uint8Array {
  return concat(
    field(1, 2, encodeString(delegatorAddress)),
    field(2, 2, encodeString(validatorAddress)),
    field(3, 2, encodeCoin(denom, amount))
  )
}

// cosmos.staking.v1beta1.MsgBeginRedelegate
//   string delegator_address = 1;
//   string validator_src_address = 2;
//   string validator_dst_address = 3;
//   cosmos.base.v1beta1.Coin amount = 4;
function buildMsgBeginRedelegate(
  delegatorAddress: string,
  validatorSrcAddress: string,
  validatorDstAddress: string,
  amount: string,
  denom: string
): Uint8Array {
  return concat(
    field(1, 2, encodeString(delegatorAddress)),
    field(2, 2, encodeString(validatorSrcAddress)),
    field(3, 2, encodeString(validatorDstAddress)),
    field(4, 2, encodeCoin(denom, amount))
  )
}

// cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward
//   string delegator_address = 1;
//   string validator_address = 2;
function buildMsgWithdrawDelegatorReward(delegatorAddress: string, validatorAddress: string): Uint8Array {
  return concat(field(1, 2, encodeString(delegatorAddress)), field(2, 2, encodeString(validatorAddress)))
}

function buildCw20TransferMsg(recipient: string, amount: string): string {
  return JSON.stringify({ transfer: { recipient, amount } })
}

function getMsgSendTypeUrl(chain: string): string {
  if (chain === 'THORChain' || chain === 'MayaChain') return '/types.MsgSend'
  return '/cosmos.bank.v1beta1.MsgSend'
}

function buildTxBody(msgAny: Uint8Array, memo: string): Uint8Array {
  let body = field(1, 2, msgAny)
  if (memo) body = concat(body, field(2, 2, encodeString(memo)))
  return body
}

// Multi-msg variant: cosmos TxBody.messages is `repeated google.protobuf.Any`,
// so we just emit field 1 once per Any. Used by staking flows where a single tx
// can withdraw rewards from many validators or batch un/redelegate ops.
function buildTxBodyMulti(msgAnys: Uint8Array[], memo: string): Uint8Array {
  let body = concat(...msgAnys.map(m => field(1, 2, m)))
  if (memo) body = concat(body, field(2, 2, encodeString(memo)))
  return body
}

function buildAuthInfo(
  pubKeyBytes: Uint8Array,
  sequence: number,
  gasLimit: number,
  denom: string,
  feeAmount: string
): Uint8Array {
  const pubKeyAny = wrapAny('/cosmos.crypto.secp256k1.PubKey', field(1, 2, pubKeyBytes))
  const singleMode = field(1, 0, varint(1))
  const modeInfoSingle = field(1, 2, singleMode)
  const signerInfo = concat(field(1, 2, pubKeyAny), field(2, 2, modeInfoSingle), field(3, 0, varint(sequence)))
  const fee = concat(field(1, 2, encodeCoin(denom, feeAmount)), field(2, 0, varint(gasLimit)))
  return concat(field(1, 2, signerInfo), field(2, 2, fee))
}

function buildSignDoc(
  txBodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  chainId: string,
  accountNumber: number
): Uint8Array {
  return concat(
    field(1, 2, txBodyBytes),
    field(2, 2, authInfoBytes),
    field(3, 2, encodeString(chainId)),
    field(4, 0, varint(accountNumber))
  )
}

// ---------------------------------------------------------------------------
// Public builder API
// ---------------------------------------------------------------------------

export type CosmosTxBuilderResult = {
  /** SHA-256 hash of the SignDoc — pass to fastVaultSign/keysign */
  signingHashHex: string
  /** The SignDoc bytes for record-keeping / debugging */
  signDocBytes: Uint8Array
  /** Bytes of the serialized TxBody */
  txBodyBytes: Uint8Array
  /** Bytes of the serialized AuthInfo */
  authInfoBytes: Uint8Array
  /**
   * Given the hex-encoded raw signature, return the broadcastable TxRaw
   * bytes, its base64, and sha256 hash.
   *
   * Accepts EITHER:
   *   - 128 hex chars (64 bytes, `r||s`) — the canonical Cosmos signature
   *   - 130 hex chars (65 bytes, `r||s||v`) — the EVM-style recovery-id form
   *     emitted by the MPC engine; the trailing recovery byte is stripped
   *     here because Cosmos doesn't carry it on-wire.
   *
   * `0x` prefix is tolerated. Anything else throws so the caller sees a
   * clear failure rather than a silently-malformed TxRaw.
   */
  finalize: (sigHex: string) => { txRawBytes: Uint8Array; txBytesBase64: string; txHashHex: string }
}

export type BuildCosmosSendOptions = {
  chainName: string
  chainId: string
  fromAddress: string
  toAddress: string
  amount: string
  denom: string
  feeAmount: string
  gasLimit: number
  sequence: number
  accountNumber: number
  /** Compressed pubkey (33 bytes) derived via deriveCosmosPubkey */
  pubKeyBytes: Uint8Array
  memo?: string
}

export function buildCosmosSendTx(opts: BuildCosmosSendOptions): CosmosTxBuilderResult {
  const isThor = opts.chainName === 'THORChain' || opts.chainName === 'MayaChain'
  const msgSend = isThor
    ? buildThorMsgSend(opts.fromAddress, opts.toAddress, opts.amount, opts.denom)
    : buildBankMsgSend(opts.fromAddress, opts.toAddress, opts.amount, opts.denom)
  const msgAny = wrapAny(getMsgSendTypeUrl(opts.chainName), msgSend)
  const txBodyBytes = buildTxBody(msgAny, opts.memo ?? '')
  const authInfoBytes = buildAuthInfo(opts.pubKeyBytes, opts.sequence, opts.gasLimit, opts.denom, opts.feeAmount)
  const signDocBytes = buildSignDoc(txBodyBytes, authInfoBytes, opts.chainId, opts.accountNumber)
  const signingHashHex = bytesToHex(sha256(signDocBytes))

  return {
    signingHashHex,
    signDocBytes,
    txBodyBytes,
    authInfoBytes,
    finalize: sigHex => finalizeCosmosTx(txBodyBytes, authInfoBytes, sigHex),
  }
}

export type BuildCosmosWasmExecuteOptions = {
  chainId: string
  fromAddress: string
  contractAddress: string
  executeMsgJson: string
  funds?: Array<{ denom: string; amount: string }>
  sequence: number
  accountNumber: number
  pubKeyBytes: Uint8Array
  gasLimit: number
  feeDenom: string
  feeAmount: string
  memo?: string
}

export function buildCosmosWasmExecuteTx(opts: BuildCosmosWasmExecuteOptions): CosmosTxBuilderResult {
  const msgExec = buildMsgExecuteContract(opts.fromAddress, opts.contractAddress, opts.executeMsgJson, opts.funds ?? [])
  const msgAny = wrapAny('/cosmwasm.wasm.v1.MsgExecuteContract', msgExec)
  const txBodyBytes = buildTxBody(msgAny, opts.memo ?? '')
  const authInfoBytes = buildAuthInfo(opts.pubKeyBytes, opts.sequence, opts.gasLimit, opts.feeDenom, opts.feeAmount)
  const signDocBytes = buildSignDoc(txBodyBytes, authInfoBytes, opts.chainId, opts.accountNumber)
  const signingHashHex = bytesToHex(sha256(signDocBytes))

  return {
    signingHashHex,
    signDocBytes,
    txBodyBytes,
    authInfoBytes,
    finalize: sigHex => finalizeCosmosTx(txBodyBytes, authInfoBytes, sigHex),
  }
}

export type BuildCw20TransferOptions = Omit<BuildCosmosWasmExecuteOptions, 'executeMsgJson'> & {
  recipient: string
  tokenAmount: string
}

export function buildCw20TransferTx(opts: BuildCw20TransferOptions): CosmosTxBuilderResult {
  const msgJson = buildCw20TransferMsg(opts.recipient, opts.tokenAmount)
  return buildCosmosWasmExecuteTx({ ...opts, executeMsgJson: msgJson })
}

export type BuildThorchainDepositOptions = {
  chainId: string
  fromAddress: string
  amountBaseUnits: string
  memo: string
  sequence: number
  accountNumber: number
  pubKeyBytes: Uint8Array
  gasLimit: number
  feeDenom: string
  feeAmount: string
}

export function buildThorchainDepositTx(opts: BuildThorchainDepositOptions): CosmosTxBuilderResult {
  const msgDeposit = buildThorMsgDeposit(opts.fromAddress, opts.amountBaseUnits, opts.memo)
  const msgAny = wrapAny('/types.MsgDeposit', msgDeposit)
  const txBodyBytes = buildTxBody(msgAny, '')
  const authInfoBytes = buildAuthInfo(opts.pubKeyBytes, opts.sequence, opts.gasLimit, opts.feeDenom, opts.feeAmount)
  const signDocBytes = buildSignDoc(txBodyBytes, authInfoBytes, opts.chainId, opts.accountNumber)
  const signingHashHex = bytesToHex(sha256(signDocBytes))
  return {
    signingHashHex,
    signDocBytes,
    txBodyBytes,
    authInfoBytes,
    finalize: sigHex => finalizeCosmosTx(txBodyBytes, authInfoBytes, sigHex),
  }
}

// ---------------------------------------------------------------------------
// Cosmos staking module (generic, all ibcEnabled cosmos chains)
// ---------------------------------------------------------------------------

/**
 * Canonical proto type URLs for cosmos-sdk staking + distribution module msgs.
 * Use SIGN_MODE_DIRECT (proto). Amino path is intentionally not provided —
 * matches the existing tx.ts convention (Send / Wasm / THORDeposit are all
 * direct-only here too).
 */
export const COSMOS_STAKING_TYPE_URLS = {
  delegate: '/cosmos.staking.v1beta1.MsgDelegate',
  undelegate: '/cosmos.staking.v1beta1.MsgUndelegate',
  redelegate: '/cosmos.staking.v1beta1.MsgBeginRedelegate',
  withdraw_rewards: '/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward',
} as const

/**
 * Discriminated union of cosmos staking msgs the builder accepts.
 *
 * Address fields are bech32 strings as they appear on-chain:
 *   - `delegatorAddress`: account hrp (e.g. `cosmos1...`, `terra1...`, `osmo1...`)
 *   - `validatorAddress` / `validatorSrcAddress` / `validatorDstAddress`:
 *     valoper hrp (e.g. `cosmosvaloper1...`, `terravaloper1...`).
 *
 * `amount` is the integer base-unit string (e.g. `'1000000'` for 1 ATOM at 6dp).
 * `denom` is the chain's fee/stake denom (e.g. `uatom`, `uluna`, `uosmo`).
 */
export type CosmosStakingMsg =
  | {
      type: 'delegate'
      delegatorAddress: string
      validatorAddress: string
      amount: string
      denom: string
    }
  | {
      type: 'undelegate'
      delegatorAddress: string
      validatorAddress: string
      amount: string
      denom: string
    }
  | {
      type: 'redelegate'
      delegatorAddress: string
      validatorSrcAddress: string
      validatorDstAddress: string
      amount: string
      denom: string
    }
  | {
      type: 'withdraw_rewards'
      delegatorAddress: string
      validatorAddress: string
    }

export type BuildCosmosStakingOptions = {
  chainId: string
  /**
   * One or more staking msgs to include in a SINGLE atomic tx. Multi-msg is
   * load-bearing for two flows:
   *   1. Withdraw rewards from many validators in one tx (saves gas + UX clicks).
   *   2. Batch undelegate across many validators (e.g. unwinding a position).
   * Order is preserved on-wire.
   */
  msgs: CosmosStakingMsg[]
  sequence: number
  accountNumber: number
  /** Compressed pubkey (33 bytes) — derive via deriveCosmosPubkey. */
  pubKeyBytes: Uint8Array
  gasLimit: number
  feeDenom: string
  feeAmount: string
  memo?: string
}

export function buildCosmosStakingTx(opts: BuildCosmosStakingOptions): CosmosTxBuilderResult {
  if (opts.msgs.length === 0) {
    throw new Error('buildCosmosStakingTx: msgs[] cannot be empty')
  }
  const msgAnys = opts.msgs.map(msg => {
    switch (msg.type) {
      case 'delegate': {
        const inner = buildMsgDelegateOrUndelegate(msg.delegatorAddress, msg.validatorAddress, msg.amount, msg.denom)
        return wrapAny(COSMOS_STAKING_TYPE_URLS.delegate, inner)
      }
      case 'undelegate': {
        const inner = buildMsgDelegateOrUndelegate(msg.delegatorAddress, msg.validatorAddress, msg.amount, msg.denom)
        return wrapAny(COSMOS_STAKING_TYPE_URLS.undelegate, inner)
      }
      case 'redelegate': {
        const inner = buildMsgBeginRedelegate(
          msg.delegatorAddress,
          msg.validatorSrcAddress,
          msg.validatorDstAddress,
          msg.amount,
          msg.denom
        )
        return wrapAny(COSMOS_STAKING_TYPE_URLS.redelegate, inner)
      }
      case 'withdraw_rewards': {
        const inner = buildMsgWithdrawDelegatorReward(msg.delegatorAddress, msg.validatorAddress)
        return wrapAny(COSMOS_STAKING_TYPE_URLS.withdraw_rewards, inner)
      }
    }
  })
  const txBodyBytes = buildTxBodyMulti(msgAnys, opts.memo ?? '')
  const authInfoBytes = buildAuthInfo(opts.pubKeyBytes, opts.sequence, opts.gasLimit, opts.feeDenom, opts.feeAmount)
  const signDocBytes = buildSignDoc(txBodyBytes, authInfoBytes, opts.chainId, opts.accountNumber)
  const signingHashHex = bytesToHex(sha256(signDocBytes))
  return {
    signingHashHex,
    signDocBytes,
    txBodyBytes,
    authInfoBytes,
    finalize: sigHex => finalizeCosmosTx(txBodyBytes, authInfoBytes, sigHex),
  }
}

function finalizeCosmosTx(
  txBodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  sigHex: string
): { txRawBytes: Uint8Array; txBytesBase64: string; txHashHex: string } {
  // Cosmos signatures are raw r||s (64 bytes = 128 hex chars). A truncated
  // signature would decode to a shorter Uint8Array and silently produce a
  // malformed tx — reject early so the caller sees a clear error.
  const cleanSig = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex
  if (cleanSig.length !== 128 && cleanSig.length !== 130) {
    throw new Error(
      `Cosmos finalize: expected 128-hex-char (r||s) or 130-hex-char (r||s||v) signature, got ${cleanSig.length}`
    )
  }
  const r = cleanSig.substring(0, 64)
  const s = cleanSig.substring(64, 128)
  const sigBytes = hexToBytes(r + s)
  const txRawBytes = concat(field(1, 2, txBodyBytes), field(2, 2, authInfoBytes), field(3, 2, sigBytes))
  // Base64 via btoa (available in Hermes/JSC, RN runtime).
  //
  // `String.fromCharCode(...txRawBytes)` spreads the Uint8Array across the
  // argument list; for a large tx that can exceed the JS engine's argument
  // limit (~65k on V8, lower on Hermes) and crash with a stack-overflow /
  // "too many arguments" error. Build the binary string in chunks instead.
  const txBytesBase64 =
    typeof btoa === 'function'
      ? btoa(bytesToBinaryString(txRawBytes))
      : (globalThis as any).Buffer.from(txRawBytes).toString('base64')
  const txHashHex = bytesToHex(sha256(txRawBytes)).toUpperCase()
  return { txRawBytes, txBytesBase64, txHashHex }
}

/** Convert a Uint8Array to a binary latin-1 string without spreading (which
 *  would crash on large inputs due to JS argument-count limits). */
function bytesToBinaryString(bytes: Uint8Array): string {
  const CHUNK = 0x8000 // 32 kB
  let out = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}
