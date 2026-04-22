/**
 * XRP Ledger (Ripple) transaction primitives for React Native.
 *
 * Vendored from vultiagent-app/src/services/xrpTx.ts. Splits the app's
 * single build+sign+broadcast helper into pure primitives so the SDK
 * consumer can drive MPC signing and broadcasting themselves.
 *
 * Imports only `ripple-binary-codec` and `ripple-address-codec` — NOT the
 * `xrpl` barrel, which transitively pulls the `Client` class and `ws` (TLS
 * transport) that Hermes cannot load.
 *
 * Exposed:
 *   - `deriveXrpAddress(compressedPubKeyHex, hexChainCode?)` — classic
 *     r-address via BIP32 child pubkey + SHA256+RIPEMD160 + base58check.
 *   - `buildXrpSendTx(opts)` — returns Payment tx JSON, the signing hash
 *     consumers pass to fastVaultSign, and a `finalize(sigHex)` callback
 *     that produces `{ signedBlobHex, txHash }` for broadcast.
 *   - `getRippleSigningInputs(opts)` — alias returning only the inputs a
 *     caller needs to request signing (tx JSON + signingHashHex).
 *   - `getRippleTxHash(signedBlobHex)` — SHA-512 half of `TXN\0` || blob.
 *   - `encodeXrpSignedTx(tx)` / `encodeXrpForSigning(tx)` — thin pass-throughs
 *     over ripple-binary-codec for callers that already have a tx object.
 *
 * RPC helpers (`getXrpAccountInfo`, `getXrpBalance`, `submitXrpTx`,
 * `getXrpLedgerCurrentIndex`) live in `./rpc.ts`.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hmac } from '@noble/hashes/hmac.js'
import { ripemd160 } from '@noble/hashes/legacy.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { encodeAccountID } from 'ripple-address-codec'
import { encode as xrplEncode, encodeForSigning } from 'ripple-binary-codec'

// ---------------------------------------------------------------------------
// secp256k1 low-S normalization (XRP requires canonical signatures)
// ---------------------------------------------------------------------------

const SECP256K1_ORDER =
  0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_HALF_ORDER = SECP256K1_ORDER / 2n

// ---------------------------------------------------------------------------
// Hex utils (RN-safe, no Buffer)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(clean.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
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

// SHA-512 half: first 32 bytes of SHA-512 (XRP signing hash function)
function sha512Half(data: Uint8Array): Uint8Array {
  return sha512(data).slice(0, 32)
}

// ---------------------------------------------------------------------------
// BIP32 child pubkey derivation (identical path to cosmos/tx.ts)
// ---------------------------------------------------------------------------

function deriveChildPubkey(
  compressedPubKeyHex: string,
  hexChainCode: string,
  path: number[]
): Uint8Array {
  let pubKeyBytes = hexToBytes(compressedPubKeyHex)
  if (!hexChainCode || hexChainCode.length === 0) return pubKeyBytes
  let chainCode = hexToBytes(hexChainCode)
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
  return pubKeyBytes
}

// ---------------------------------------------------------------------------
// Address derivation: classic r-address from compressed secp256k1 pubkey.
// ---------------------------------------------------------------------------

/**
 * Derive an XRP classic r-address from a compressed secp256k1 pubkey.
 * When `hexChainCode` is provided (non-empty), applies the standard XRP
 * derivation path `m/44'/144'/0'/0/0` as non-hardened steps — matching the
 * vault's stored ECDSA root key. Pass an empty chainCode if the pubkey is
 * already the leaf child key.
 *
 * Address = base58check(0x00 || ripemd160(sha256(pubkey))).
 */
export function deriveXrpAddress(
  compressedPubKeyHex: string,
  hexChainCode = ''
): string {
  const pubKeyBytes = deriveChildPubkey(
    compressedPubKeyHex,
    hexChainCode,
    [44, 144, 0, 0, 0]
  )
  const sha = sha256(pubKeyBytes)
  const accountID = ripemd160(sha)
  return encodeAccountID(accountID)
}

/**
 * Derive the compressed secp256k1 pubkey bytes used in the `SigningPubKey`
 * field of an XRP Payment transaction. Uses the same BIP32 path as
 * deriveXrpAddress.
 */
export function deriveXrpPubkey(
  compressedPubKeyHex: string,
  hexChainCode = ''
): Uint8Array {
  return deriveChildPubkey(
    compressedPubKeyHex,
    hexChainCode,
    [44, 144, 0, 0, 0]
  )
}

// ---------------------------------------------------------------------------
// Transaction building primitives
// ---------------------------------------------------------------------------

export type XrpPaymentTx = {
  TransactionType: 'Payment'
  Account: string
  Destination: string
  Amount: string
  Fee: string
  Sequence: number
  LastLedgerSequence: number
  SigningPubKey: string
  DestinationTag?: number
  Memos?: Array<{ Memo: { MemoData: string; MemoType?: string } }>
  TxnSignature?: string
}

export type BuildXrpSendOptions = {
  /** Sender r-address (classic address). */
  account: string
  /** Recipient r-address (classic address). */
  destination: string
  /** Amount in drops (1 XRP = 1,000,000 drops), as a string. */
  amount: string
  /** Fee in drops, as a string. */
  fee: string
  /** Account sequence (from account_info). */
  sequence: number
  /** LastLedgerSequence — typically currentIndex + 4 for safety. */
  lastLedgerSequence: number
  /** Signing compressed pubkey hex, 33 bytes (uppercased internally). */
  signingPubKey: string
  /** Optional destination tag for exchange deposits. */
  destinationTag?: number
  /** Optional memo string (UTF-8, wrapped in text/plain MIME type). */
  memo?: string
}

export type BuildXrpSendResult = {
  /** The pre-signed XRP Payment transaction object. */
  tx: XrpPaymentTx
  /** SHA-512 half of encodeForSigning bytes — hex string ready for fastVaultSign. */
  signingHashHex: string
  /** Bytes the hash was computed over (the encodeForSigning output, hex). */
  encodedForSigningHex: string
  /**
   * Finalize by attaching a DER-encoded signature to the tx.
   * `sigHex` is the 128-char R||S hex returned by fastVaultSign (ECDSA MPC).
   */
  finalize: (sigHex: string) => {
    /** Serialized signed tx blob (hex) — pass to submitXrpTx. */
    signedBlobHex: string
    /** XRP transaction hash (uppercase hex). */
    txHash: string
    /** The tx object with `TxnSignature` attached. */
    signedTx: XrpPaymentTx
  }
}

/**
 * Build an XRP Payment transaction with signing hash + finalize callback.
 *
 * Flow:
 *   1. Caller invokes `buildXrpSendTx(opts)`.
 *   2. Caller signs `signingHashHex` via fastVaultSign (ECDSA MPC, secp256k1).
 *   3. Caller invokes `finalize(sigHex)` — returns `{ signedBlobHex, txHash }`.
 *   4. Caller broadcasts via `submitXrpTx(signedBlobHex, rpcUrl)`.
 */
export function buildXrpSendTx(opts: BuildXrpSendOptions): BuildXrpSendResult {
  const tx: XrpPaymentTx = {
    TransactionType: 'Payment',
    Account: opts.account,
    Destination: opts.destination,
    Amount: opts.amount,
    Fee: opts.fee,
    Sequence: opts.sequence,
    LastLedgerSequence: opts.lastLedgerSequence,
    SigningPubKey: opts.signingPubKey.toUpperCase(),
  }

  if (opts.destinationTag !== undefined) {
    tx.DestinationTag = opts.destinationTag
  }

  if (opts.memo) {
    tx.Memos = [
      {
        Memo: {
          MemoData: utf8ToHex(opts.memo).toUpperCase(),
          MemoType: utf8ToHex('text/plain').toUpperCase(),
        },
      },
    ]
  }

  const encodedForSigningHex = encodeForSigning(tx as unknown as Parameters<typeof encodeForSigning>[0])
  const signingHashBytes = sha512Half(hexToBytes(encodedForSigningHex))
  const signingHashHex = bytesToHex(signingHashBytes)

  const finalize = (sigHex: string) => {
    const rHex = sigHex.substring(0, 64)
    const sHexRaw = sigHex.substring(64, 128)
    // Normalize S to low-S form (BIP-62 / XRP canonical sig rule)
    const sBI = BigInt('0x' + sHexRaw)
    const normalizedS =
      sBI > SECP256K1_HALF_ORDER ? SECP256K1_ORDER - sBI : sBI
    const sHex = normalizedS.toString(16).padStart(64, '0')
    const derSig = derEncode(rHex, sHex)
    const signedTx: XrpPaymentTx = { ...tx, TxnSignature: derSig.toUpperCase() }
    const signedBlobHex = xrplEncode(
      signedTx as unknown as Parameters<typeof xrplEncode>[0]
    )
    const txHash = getRippleTxHash(signedBlobHex)
    return { signedBlobHex, txHash, signedTx }
  }

  return { tx, signingHashHex, encodedForSigningHex, finalize }
}

/**
 * Harness-compatible alias that returns just the inputs a caller needs to
 * request an MPC signature. Equivalent to calling `buildXrpSendTx` but
 * exposes only the fields a signing orchestrator consumes.
 */
export function getRippleSigningInputs(opts: BuildXrpSendOptions): {
  tx: XrpPaymentTx
  signingHashHex: string
  encodedForSigningHex: string
} {
  const { tx, signingHashHex, encodedForSigningHex } = buildXrpSendTx(opts)
  return { tx, signingHashHex, encodedForSigningHex }
}

/**
 * Compute the XRP transaction hash from a signed, serialized tx blob.
 * Hash = SHA-512 half over `"TXN\0"` prefix || blob bytes.
 */
export function getRippleTxHash(signedBlobHex: string): string {
  const TXN_PREFIX = new Uint8Array([0x54, 0x58, 0x4e, 0x00])
  const hashBytes = sha512Half(concat(TXN_PREFIX, hexToBytes(signedBlobHex)))
  return bytesToHex(hashBytes).toUpperCase()
}

/**
 * Thin pass-through over ripple-binary-codec's `encode` — returns the full
 * serialized blob (signed if TxnSignature is set). Exposed so callers with
 * a prebuilt tx object don't need the full buildXrpSendTx flow.
 */
export function encodeXrpSignedTx(tx: XrpPaymentTx): string {
  return xrplEncode(tx as unknown as Parameters<typeof xrplEncode>[0])
}

/**
 * Thin pass-through over ripple-binary-codec's `encodeForSigning` — returns
 * the signing-prefixed serialization (what `sha512Half` is applied to).
 */
export function encodeXrpForSigning(tx: XrpPaymentTx): string {
  return encodeForSigning(tx as unknown as Parameters<typeof encodeForSigning>[0])
}

// ---------------------------------------------------------------------------
// DER signature encoding (ASN.1 SEQUENCE { r INTEGER, s INTEGER })
// ---------------------------------------------------------------------------

function derEncode(rHex: string, sHex: string): string {
  let r = hexToBytes(rHex)
  let s = hexToBytes(sHex)
  // Strip leading zero bytes until high bit would be set (avoids negative encoding).
  while (r.length > 1 && r[0] === 0x00 && (r[1] ?? 0) < 0x80) r = r.slice(1)
  while (s.length > 1 && s[0] === 0x00 && (s[1] ?? 0) < 0x80) s = s.slice(1)
  // Prepend 0x00 if high bit is set (prevents misinterpretation as negative).
  if ((r[0] ?? 0) >= 0x80) r = concat(new Uint8Array([0x00]), r)
  if ((s[0] ?? 0) >= 0x80) s = concat(new Uint8Array([0x00]), s)
  const rLen = r.length
  const sLen = s.length
  return bytesToHex(
    concat(
      new Uint8Array([0x30, rLen + sLen + 4, 0x02, rLen]),
      r,
      new Uint8Array([0x02, sLen]),
      s
    )
  )
}

function utf8ToHex(s: string): string {
  const bytes = new TextEncoder().encode(s)
  return bytesToHex(bytes)
}
