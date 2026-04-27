/**
 * UTXO transaction encoding primitives (platform-agnostic).
 *
 * Vendored from vultiagent-app/src/services/utxoTx.ts and reshaped into a
 * Cosmos-style builder that returns pre-signing artefacts + a `finalize`
 * callback, so consumers sign each input's `signingHashHex` via their own
 * signer (fastVaultSign, WalletCore, keysign, etc) and reassemble the
 * broadcastable tx without the builder owning the network step.
 *
 * Supports:
 *   - P2WPKH (BIP143 sighash): Bitcoin, Litecoin
 *   - P2PKH legacy sighash:    Dogecoin, Dash
 *   - BIP143-style with SIGHASH_FORKID (0x41): Bitcoin-Cash
 *   - ZIP-243 + BLAKE2b personalization: Zcash (transparent send)
 *
 * No bitcoinjs-lib dependency — all encoding is hand-rolled on top of
 * `@noble/hashes` + `@scure/base`, matching the app's approach so that the
 * RN bundle stays Hermes-safe and non-RN bundles don't inflate.
 *
 * Surface:
 *   - `buildUtxoSendTx(opts)` — native-token send; returns multi-input
 *     `signingHashesHex[]`, `unsignedRawHex`, and `finalize(sigHexes)`.
 *   - `getSighashBIP143(opts)` — standalone BIP143 segwit sighash.
 *   - `getSighashLegacy(opts)` — standalone legacy P2PKH / BCH / Zcash sighash.
 *   - `decodeAddressToPubKeyHash(addr, chain)` — address → {pubKeyHash, type}.
 */
import { secp256k1 as secp } from '@noble/curves/secp256k1.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bech32 } from '@scure/base'
import bs58check from 'bs58check'

// ---------------------------------------------------------------------------
// Chain identifiers — string-typed to keep the module free of @vultisig/core-chain.
// Consumers pass the Chain enum value as a string; the RN wrapper supplies a
// typed overload.
// ---------------------------------------------------------------------------

export type UtxoChainName = 'Bitcoin' | 'Litecoin' | 'Dogecoin' | 'Dash' | 'Bitcoin-Cash' | 'Zcash'

type UtxoScriptKind = 'p2pkh' | 'p2wpkh' | 'p2sh'

type UtxoChainSpec = {
  scriptType: UtxoScriptKind
  /** Minimum output value in base units; smaller outputs are dust */
  dustLimit: bigint
  /** BIP44/84 slip44 coin type — matches vultisig address derivation */
  slip44: number
  /** BIP84 for BTC/LTC native-segwit, BIP44 for the rest */
  bipPurpose: 44 | 84
}

const UTXO_SPECS: Record<UtxoChainName, UtxoChainSpec> = {
  Bitcoin: { scriptType: 'p2wpkh', dustLimit: 546n, slip44: 0, bipPurpose: 84 },
  Litecoin: { scriptType: 'p2wpkh', dustLimit: 1_000n, slip44: 2, bipPurpose: 84 },
  Dogecoin: { scriptType: 'p2pkh', dustLimit: 1_000_000n, slip44: 3, bipPurpose: 44 },
  'Bitcoin-Cash': { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 145, bipPurpose: 44 },
  Dash: { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 5, bipPurpose: 44 },
  Zcash: { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 133, bipPurpose: 44 },
}

export const getUtxoChainSpec = (chain: UtxoChainName): UtxoChainSpec => UTXO_SPECS[chain]

// ---------------------------------------------------------------------------
// Hex / binary helpers — no Buffer, RN-safe.
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

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0)
  const result = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) {
    result.set(a, offset)
    offset += a.length
  }
  return result
}

function doubleSha256(data: Uint8Array): Uint8Array {
  return sha256(sha256(data))
}

function writeU32LE(v: number): Uint8Array {
  const b = new Uint8Array(4)
  b[0] = v & 0xff
  b[1] = (v >> 8) & 0xff
  b[2] = (v >> 16) & 0xff
  b[3] = (v >> 24) & 0xff
  return b
}

function writeU64LE(v: bigint): Uint8Array {
  const b = new Uint8Array(8)
  for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(i * 8)) & 0xffn)
  return b
}

function writeVarInt(v: number): Uint8Array {
  if (v < 0xfd) return new Uint8Array([v])
  if (v <= 0xffff) return new Uint8Array([0xfd, v & 0xff, (v >> 8) & 0xff])
  return new Uint8Array([0xfe, v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff])
}

function reverseHexBytes(hex: string): Uint8Array {
  return hexToBytes(hex).reverse()
}

// ---------------------------------------------------------------------------
// BIP32 non-hardened child key derivation (shared with Cosmos bridge).
// ---------------------------------------------------------------------------

function deriveChild(parentPubKey: Uint8Array, parentChainCode: Uint8Array, index: number) {
  const data = new Uint8Array(37)
  data.set(parentPubKey, 0)
  data[33] = (index >>> 24) & 0xff
  data[34] = (index >>> 16) & 0xff
  data[35] = (index >>> 8) & 0xff
  data[36] = index & 0xff
  const I = hmac(sha512, parentChainCode, data)
  const IL = I.slice(0, 32)
  const IR = I.slice(32)
  const parentPoint = secp.Point.fromHex(bytesToHex(parentPubKey))
  const tweakPoint = secp.Point.BASE.multiply(BigInt('0x' + bytesToHex(IL)))
  return { publicKey: parentPoint.add(tweakPoint).toBytes(true), chainCode: IR }
}

/**
 * Derive the per-chain compressed pubkey used for the scriptSig / witness.
 * Applies the chain's BIP path (`m/{purpose}/{slip44}/0/0/0`).
 */
export function deriveUtxoPubkey(
  compressedRootPubKeyHex: string,
  hexChainCode: string,
  chain: UtxoChainName
): Uint8Array {
  const spec = UTXO_SPECS[chain]
  let pub = hexToBytes(compressedRootPubKeyHex)
  if (!hexChainCode || hexChainCode.length === 0) return pub
  let cc = hexToBytes(hexChainCode)
  for (const idx of [spec.bipPurpose, spec.slip44, 0, 0, 0]) {
    const child = deriveChild(pub, cc, idx)
    pub = child.publicKey
    cc = child.chainCode
  }
  return pub
}

// ---------------------------------------------------------------------------
// Address decoding
// ---------------------------------------------------------------------------

/**
 * BCH CashAddr polymod checksum.
 *
 * Spec: https://reference.cash/protocol/blockchain/encoding/cashaddr
 *
 * The checksum is computed over `lower5(prefix) || 0 || payload5 || checksum5`
 * (payload5 already contains the 8 trailing checksum symbols). A valid address
 * produces polymod === 0. Bit-fiddling follows the reference C implementation:
 * 5-symbol state, pre-multiply by 0x20, XOR each input symbol, and conditionally
 * XOR the five generator polynomials based on the high bit of `c0`.
 *
 * We use `BigInt` because the generator coefficients exceed 32 bits and JS
 * `number` bit-ops truncate to i32 — that silently drops the checksum's
 * top bits and would accept invalid addresses.
 */
function cashAddrPolymod(values: number[]): bigint {
  const GEN: bigint[] = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n]
  let c: bigint = 1n
  for (const v of values) {
    const c0 = c >> 35n
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(v)
    for (let i = 0; i < 5; i++) {
      if (((c0 >> BigInt(i)) & 1n) === 1n) c ^= GEN[i]!
    }
  }
  return c ^ 1n
}

function verifyCashAddrChecksum(prefix: string, data5: number[]): boolean {
  // Low-5-bit representation of the prefix characters (ASCII & 0x1f).
  const prefixLower5 = Array.from(prefix, ch => ch.charCodeAt(0) & 0x1f)
  // Polymod input: lower5(prefix) || [0] || data5 (data5 already includes the
  // 8-symbol trailing checksum, so we don't pad separately).
  const values = [...prefixLower5, 0, ...data5]
  return cashAddrPolymod(values) === 0n
}

export type DecodedAddress = {
  pubKeyHash: Uint8Array
  type: UtxoScriptKind
}

/**
 * Decode a UTXO address into its 20-byte pubKeyHash + script type.
 * Recognises bech32 (BTC/LTC native segwit), CashAddr (BCH), and base58check
 * (DOGE/DASH/Zcash/legacy BTC).
 */
export function decodeAddressToPubKeyHash(address: string, chain: UtxoChainName): DecodedAddress {
  // bech32 (BTC bc1q..., LTC ltc1q...)
  // We deliberately try bech32 first; non-bech32 addresses fall through to
  // CashAddr / base58 below. We DO NOT swallow the 32-byte (P2WSH) error
  // because the caller asked us to encode a script that this SDK can't yet
  // build — silently treating the 32-byte witness program as a 20-byte
  // P2WPKH would lock funds under a hash matching no spendable script.
  let bech32Decoded: ReturnType<typeof bech32.decode> | undefined
  try {
    bech32Decoded = bech32.decode(address as `${string}1${string}`)
  } catch {
    /* not bech32 — fall through to other encodings */
  }
  if (bech32Decoded) {
    if (bech32Decoded.words[0] === 0) {
      const program = new Uint8Array(bech32.fromWords(bech32Decoded.words.slice(1)))
      if (program.length === 20) {
        return { pubKeyHash: program, type: 'p2wpkh' }
      }
      if (program.length === 32) {
        // BIP-141 witness v0 with a 32-byte program is P2WSH. Building a
        // P2WPKH locking script over a 32-byte hash silently encodes the
        // wrong scriptPubKey (`OP_0 <32-byte>` is valid but is a P2WSH
        // commit, not P2WPKH); the SDK would then treat it as P2WPKH at
        // sighash time, mis-derive the scriptCode, and produce a tx that
        // can't be unlocked. Reject explicitly so the caller surfaces the
        // gap rather than locking funds.
        throw new Error(
          `Cannot decode address: ${address} — P2WSH (32-byte witness v0) is not supported by this SDK build`
        )
      }
      throw new Error(`Cannot decode address: ${address} — unexpected witness v0 program length ${program.length}`)
    }
    // witness v1+ (taproot etc) is not supported here either
  }

  // CashAddr (BCH bitcoincash:q...)
  try {
    const cashAddr = address.includes(':') ? address : `bitcoincash:${address}`
    const [prefix, payload] = cashAddr.split(':') as [string, string]
    if (prefix === 'bitcoincash' && payload) {
      const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
      const data5: number[] = []
      for (const c of payload) {
        const idx = CHARSET.indexOf(c)
        if (idx === -1) throw new Error('invalid cashaddr char')
        data5.push(idx)
      }
      // Verify the polymod checksum BEFORE stripping it. Skipping this step
      // means any mistyped address with valid base32 chars decodes to a
      // garbage pubKeyHash and the tx is signed to an address the user
      // never intended. Reference:
      //   https://reference.cash/protocol/blockchain/encoding/cashaddr
      if (!verifyCashAddrChecksum(prefix, data5)) {
        throw new Error('CashAddr checksum mismatch')
      }
      const payload5 = data5.slice(0, -8) // strip 8-symbol checksum (now verified)
      let acc = 0
      let bits = 0
      const result: number[] = []
      for (const v of payload5) {
        acc = (acc << 5) | v
        bits += 5
        while (bits >= 8) {
          bits -= 8
          result.push((acc >> bits) & 0xff)
        }
      }
      // CashAddr type byte (high nibble of result[0]):
      //   0x00 → P2PKH (q...)
      //   0x08 → P2SH  (p...)
      // see https://reference.cash/protocol/blockchain/encoding/cashaddr
      if (result.length >= 21) {
        if (result[0] === 0x00) {
          return { pubKeyHash: new Uint8Array(result.slice(1, 21)), type: 'p2pkh' }
        }
        if (result[0] === 0x08) {
          // BCH P2SH — without this branch the address falls all the way to
          // the bottom-of-function `Cannot decode` throw. Worse, if a future
          // change ever made the fallthrough silent, a `bitcoincash:p...`
          // deposit address would re-encode as P2PKH and lock funds. Add the
          // branch + a regression test pinning the hash slice.
          return { pubKeyHash: new Uint8Array(result.slice(1, 21)), type: 'p2sh' }
        }
      }
    }
  } catch {
    /* not cashaddr */
  }

  // base58check (DOGE D..., Zcash t1..., legacy BTC 1...)
  try {
    const decoded = bs58check.decode(address)
    // Zcash t-addresses use a 2-byte version prefix:
    //   0x1c, 0xb8 → t1... (P2PKH)
    //   0x1c, 0xbd → t3... (P2SH)
    if (chain === 'Zcash' && decoded.length === 22 && decoded[0] === 0x1c) {
      if (decoded[1] === 0xb8) return { pubKeyHash: decoded.slice(2), type: 'p2pkh' }
      if (decoded[1] === 0xbd) return { pubKeyHash: decoded.slice(2), type: 'p2sh' }
    }
    // Single-byte version prefixes:
    //   BTC:  0x00 (P2PKH, 1...) | 0x05 (P2SH, 3...)
    //   LTC:  0x30 (P2PKH, L...) | 0x32 (P2SH, M...) — modern LTC P2SH; 0x05 also accepted by some hosts
    //   DOGE: 0x1e (P2PKH, D...) | 0x16 (P2SH, A.../9...)
    //   DASH: 0x4c (P2PKH, X...) | 0x10 (P2SH, 7...)
    // Any unknown version byte falls through to P2PKH for backward compat with
    // the previous behaviour — known-P2SH gets explicit handling so the SDK
    // doesn't silently re-encode a P2SH deposit address as P2PKH (which would
    // lock funds).
    const version = decoded[0]
    const P2SH_VERSIONS = new Set<number>([0x05, 0x32, 0x16, 0x10])
    const type: UtxoScriptKind = P2SH_VERSIONS.has(version!) ? 'p2sh' : 'p2pkh'
    return { pubKeyHash: decoded.slice(1), type }
  } catch {
    /* not base58 */
  }

  throw new Error(`Cannot decode address: ${address}`)
}

function buildScriptPubKey(pubKeyHash: Uint8Array, type: UtxoScriptKind): Uint8Array {
  if (type === 'p2pkh') {
    // OP_DUP OP_HASH160 <20-byte-hash> OP_EQUALVERIFY OP_CHECKSIG
    return concat(new Uint8Array([0x76, 0xa9, 0x14]), pubKeyHash, new Uint8Array([0x88, 0xac]))
  }
  if (type === 'p2sh') {
    // OP_HASH160 <20-byte-script-hash> OP_EQUAL
    return concat(new Uint8Array([0xa9, 0x14]), pubKeyHash, new Uint8Array([0x87]))
  }
  // OP_0 <20-byte-hash>
  return concat(new Uint8Array([0x00, 0x14]), pubKeyHash)
}

// ---------------------------------------------------------------------------
// Sighash primitives
// ---------------------------------------------------------------------------

export type UtxoInput = {
  /** Previous-output transaction hash (hex, NOT reversed) */
  hash: string
  /** Previous-output index */
  index: number
  /** Value in base units — required for BIP143 + BCH + Zcash */
  value: bigint
}

export type SighashBIP143Options = {
  inputs: UtxoInput[]
  /** Serialized outputs WITHOUT the leading varint count */
  outputsRaw: Uint8Array
  inputIndex: number
  /** 20-byte RIPEMD160(SHA256(pubKey)) of the signing input's owner */
  pubKeyHash: Uint8Array
  /** 1 for pre-segwit (BCH/Zcash); 2 for segwit (BTC/LTC) */
  version?: number
  /** 0x01 for SIGHASH_ALL; 0x41 for BCH SIGHASH_ALL | SIGHASH_FORKID */
  sighashType?: number
}

/**
 * BIP143 segwit sighash (BTC/LTC) — also used as the BCH sighash with
 * `sighashType = 0x41` since BCH applies BIP143-style to all tx types.
 */
export function getSighashBIP143(opts: SighashBIP143Options): Uint8Array {
  const { inputs, outputsRaw, inputIndex, pubKeyHash } = opts
  const version = opts.version ?? 2
  const sighashType = opts.sighashType ?? 0x01
  const input = inputs[inputIndex]
  if (!input) throw new Error(`invalid inputIndex=${inputIndex}`)

  const hashPrevouts = doubleSha256(concat(...inputs.map(i => concat(reverseHexBytes(i.hash), writeU32LE(i.index)))))
  const hashSequence = doubleSha256(concat(...inputs.map(() => writeU32LE(0xffffffff))))
  const hashOutputs = doubleSha256(outputsRaw)
  const scriptCode = concat(new Uint8Array([0x76, 0xa9, 0x14]), pubKeyHash, new Uint8Array([0x88, 0xac]))

  return doubleSha256(
    concat(
      writeU32LE(version),
      hashPrevouts,
      hashSequence,
      reverseHexBytes(input.hash),
      writeU32LE(input.index),
      writeVarInt(scriptCode.length),
      scriptCode,
      writeU64LE(input.value),
      writeU32LE(0xffffffff),
      hashOutputs,
      writeU32LE(0), // locktime
      writeU32LE(sighashType)
    )
  )
}

export type SighashLegacyOptions = {
  inputs: UtxoInput[]
  /** Serialized outputs WITH the leading varint count */
  outputsWithCount: Uint8Array
  inputIndex: number
  /** The signing input's scriptPubKey — P2PKH only here */
  scriptPubKey: Uint8Array
}

/**
 * Legacy P2PKH sighash (DOGE, DASH).
 */
export function getSighashLegacy(opts: SighashLegacyOptions): Uint8Array {
  const { inputs, outputsWithCount, inputIndex, scriptPubKey } = opts
  const parts: Uint8Array[] = [writeU32LE(1), writeVarInt(inputs.length)] // version=1
  for (let i = 0; i < inputs.length; i++) {
    parts.push(reverseHexBytes(inputs[i]!.hash), writeU32LE(inputs[i]!.index))
    if (i === inputIndex) {
      parts.push(writeVarInt(scriptPubKey.length), scriptPubKey)
    } else {
      parts.push(writeVarInt(0))
    }
    parts.push(writeU32LE(0xffffffff))
  }
  parts.push(outputsWithCount, writeU32LE(0), writeU32LE(1)) // locktime=0, SIGHASH_ALL
  return doubleSha256(concat(...parts))
}

// ---------------------------------------------------------------------------
// Zcash-specific constants + sighash (ZIP-243 with BLAKE2b personalization)
// ---------------------------------------------------------------------------

/**
 * Default Zcash consensus branch ID (NU6.1, the epoch active at the time
 * of writing). Consumers SHOULD override via `buildUtxoSendTx({zcashBranchId})`
 * for pre-activation signing — relying on a compiled-in default means every
 * Zcash network upgrade turns into a shipped-SDK-release blocker.
 *
 * Look up the current value at tx-build time from a Zcash node:
 *   zcash-cli getblockchaininfo | jq '.consensus.nextblock'
 */
export const ZCASH_BRANCH_ID_NU6_1 = 0x4dec4df0
const ZCASH_V4_VERSION = 0x80000004 // overwintered v4
const ZCASH_SAPLING_VERSION_GROUP_ID = 0x892f2085

function zcashPersonalization(prefix: string, branchId: number): Uint8Array {
  const prefixBytes = new TextEncoder().encode(prefix)
  if (prefixBytes.length === 16) {
    // 16-byte "ZcashPrevoutHash" / "ZcashSequencHash" / "ZcashOutputsHash"
    return prefixBytes
  }
  // 12-byte prefix + 4-byte branchId LE (e.g. "ZcashSigHash" + branchId)
  const pers = new Uint8Array(16)
  pers.set(prefixBytes.slice(0, 12))
  pers[12] = branchId & 0xff
  pers[13] = (branchId >> 8) & 0xff
  pers[14] = (branchId >> 16) & 0xff
  pers[15] = (branchId >> 24) & 0xff
  return pers
}

function blake2b256(data: Uint8Array, personalization: Uint8Array): Uint8Array {
  return blake2b(data, { dkLen: 32, personalization })
}

function getSighashZcash(
  inputs: UtxoInput[],
  outputsRaw: Uint8Array,
  inputIndex: number,
  pubKeyHash: Uint8Array,
  branchId: number
): Uint8Array {
  const input = inputs[inputIndex]!
  const hashPrevouts = blake2b256(
    concat(...inputs.map(i => concat(reverseHexBytes(i.hash), writeU32LE(i.index)))),
    zcashPersonalization('ZcashPrevoutHash', branchId)
  )
  const hashSequence = blake2b256(
    concat(...inputs.map(() => writeU32LE(0xffffffff))),
    zcashPersonalization('ZcashSequencHash', branchId)
  )
  const hashOutputs = blake2b256(outputsRaw, zcashPersonalization('ZcashOutputsHash', branchId))
  const scriptCode = concat(new Uint8Array([0x76, 0xa9, 0x14]), pubKeyHash, new Uint8Array([0x88, 0xac]))
  const preimage = concat(
    writeU32LE(ZCASH_V4_VERSION),
    writeU32LE(ZCASH_SAPLING_VERSION_GROUP_ID),
    hashPrevouts,
    hashSequence,
    hashOutputs,
    new Uint8Array(32), // hashJoinSplits
    new Uint8Array(32), // hashShieldedSpends
    new Uint8Array(32), // hashShieldedOutputs
    writeU32LE(0), // nLockTime
    writeU32LE(0), // nExpiryHeight
    writeU64LE(0n), // valueBalance (transparent-only)
    writeU32LE(1), // nHashType (SIGHASH_ALL)
    reverseHexBytes(input.hash),
    writeU32LE(input.index),
    writeVarInt(scriptCode.length),
    scriptCode,
    writeU64LE(input.value),
    writeU32LE(0xffffffff)
  )
  return blake2b256(preimage, zcashPersonalization('ZcashSigHash', branchId))
}

// ---------------------------------------------------------------------------
// Output serialization
// ---------------------------------------------------------------------------

function serializeOutputs(
  toScriptPubKey: Uint8Array,
  amount: bigint,
  changeScriptPubKey: Uint8Array | null,
  change: bigint,
  dustLimit: bigint
): { outputsWithCount: Uint8Array; outputsRaw: Uint8Array } {
  const hasChange = changeScriptPubKey && change > dustLimit
  const numOutputs = hasChange ? 2 : 1
  const parts: Uint8Array[] = []
  parts.push(writeU64LE(amount), writeVarInt(toScriptPubKey.length), toScriptPubKey)
  if (hasChange && changeScriptPubKey) {
    parts.push(writeU64LE(change), writeVarInt(changeScriptPubKey.length), changeScriptPubKey)
  }
  const outputsRaw = concat(...parts)
  const outputsWithCount = concat(writeVarInt(numOutputs), outputsRaw)
  return { outputsWithCount, outputsRaw }
}

// ---------------------------------------------------------------------------
// Signature DER encoding (strict BIP66-style minimal encoding, low-S normalized)
// ---------------------------------------------------------------------------

const SECP256K1_ORDER = 0xffffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_HALF_ORDER = SECP256K1_ORDER / 2n

function derEncodeRS(rHex: string, sHex: string): Uint8Array {
  // Normalise S to low-S (BIP62) — required by Bitcoin Core for standard txs.
  const sBI = BigInt('0x' + sHex)
  const normalizedS = sBI > SECP256K1_HALF_ORDER ? SECP256K1_ORDER - sBI : sBI
  const sNorm = normalizedS.toString(16).padStart(64, '0')

  let r = hexToBytes(rHex)
  let s = hexToBytes(sNorm)
  // Strip leading zeros (DER minimal encoding) while preserving sign invariant.
  while (r.length > 1 && r[0] === 0x00 && (r[1]! & 0x80) === 0) r = r.slice(1)
  while (s.length > 1 && s[0] === 0x00 && (s[1]! & 0x80) === 0) s = s.slice(1)
  // Add 0x00 sign byte if high bit set (DER integers are positive).
  if ((r[0]! & 0x80) !== 0) r = concat(new Uint8Array([0x00]), r)
  if ((s[0]! & 0x80) !== 0) s = concat(new Uint8Array([0x00]), s)
  const rLen = r.length
  const sLen = s.length
  return concat(new Uint8Array([0x30, rLen + sLen + 4, 0x02, rLen]), r, new Uint8Array([0x02, sLen]), s)
}

// ---------------------------------------------------------------------------
// Tx assembly (P2PKH / P2WPKH / Zcash v4)
// ---------------------------------------------------------------------------

function assembleP2pkhTx(
  inputs: UtxoInput[],
  signatures: Uint8Array[],
  compressedPubKey: Uint8Array,
  outputsWithCount: Uint8Array,
  sighashByte: number
): Uint8Array {
  const parts: Uint8Array[] = [writeU32LE(1), writeVarInt(inputs.length)] // version=1
  for (let i = 0; i < inputs.length; i++) {
    const sig = signatures[i]!
    const sigWithHashType = concat(sig, new Uint8Array([sighashByte]))
    const scriptSig = concat(
      writeVarInt(sigWithHashType.length),
      sigWithHashType,
      writeVarInt(compressedPubKey.length),
      compressedPubKey
    )
    parts.push(reverseHexBytes(inputs[i]!.hash), writeU32LE(inputs[i]!.index))
    parts.push(writeVarInt(scriptSig.length), scriptSig)
    parts.push(writeU32LE(0xffffffff))
  }
  parts.push(outputsWithCount, writeU32LE(0)) // locktime
  return concat(...parts)
}

/**
 * Serialize the BIP141 "base" (witness-stripped) form of a P2WPKH tx:
 *   version(4) || inputs || outputs || locktime(4)
 * This is what the tx's **txid** is hashed over — NOT the broadcastable form
 * (which includes the segwit marker + flag + witness stack, and hashes to
 * the wtxid). Callers need this separately to compute a txid that matches
 * block-explorer and mempool lookups.
 */
function serializeP2wpkhBaseTx(inputs: UtxoInput[], outputsWithCount: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [
    writeU32LE(2), // version=2
    writeVarInt(inputs.length),
  ]
  for (const input of inputs) {
    parts.push(reverseHexBytes(input.hash), writeU32LE(input.index))
    parts.push(writeVarInt(0)) // empty scriptSig for P2WPKH
    parts.push(writeU32LE(0xffffffff))
  }
  parts.push(outputsWithCount, writeU32LE(0)) // locktime=0
  return concat(...parts)
}

function assembleP2wpkhTx(
  inputs: UtxoInput[],
  signatures: Uint8Array[],
  compressedPubKey: Uint8Array,
  outputsWithCount: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [
    writeU32LE(2), // version=2
    new Uint8Array([0x00, 0x01]), // segwit marker + flag
    writeVarInt(inputs.length),
  ]
  // Inputs: empty scriptSig for P2WPKH.
  for (const input of inputs) {
    parts.push(reverseHexBytes(input.hash), writeU32LE(input.index))
    parts.push(writeVarInt(0))
    parts.push(writeU32LE(0xffffffff))
  }
  parts.push(outputsWithCount)
  // Witness stack per input: <2> <sig+hashType> <pubkey>
  for (let i = 0; i < inputs.length; i++) {
    const sig = signatures[i]!
    const sigWithHashType = concat(sig, new Uint8Array([0x01]))
    parts.push(new Uint8Array([0x02]))
    parts.push(writeVarInt(sigWithHashType.length), sigWithHashType)
    parts.push(writeVarInt(compressedPubKey.length), compressedPubKey)
  }
  parts.push(writeU32LE(0)) // locktime
  return concat(...parts)
}

function assembleZcashTx(
  inputs: UtxoInput[],
  signatures: Uint8Array[],
  compressedPubKey: Uint8Array,
  outputsWithCount: Uint8Array
): Uint8Array {
  const parts: Uint8Array[] = [
    writeU32LE(ZCASH_V4_VERSION),
    writeU32LE(ZCASH_SAPLING_VERSION_GROUP_ID),
    writeVarInt(inputs.length),
  ]
  for (let i = 0; i < inputs.length; i++) {
    const sig = signatures[i]!
    const sigWithHashType = concat(sig, new Uint8Array([0x01]))
    const scriptSig = concat(
      writeVarInt(sigWithHashType.length),
      sigWithHashType,
      writeVarInt(compressedPubKey.length),
      compressedPubKey
    )
    parts.push(reverseHexBytes(inputs[i]!.hash), writeU32LE(inputs[i]!.index))
    parts.push(writeVarInt(scriptSig.length), scriptSig)
    parts.push(writeU32LE(0xffffffff))
  }
  parts.push(outputsWithCount)
  parts.push(
    writeU32LE(0), // nLockTime
    writeU32LE(0), // nExpiryHeight
    writeU64LE(0n), // valueBalance
    new Uint8Array([0x00]), // vShieldedSpend count
    new Uint8Array([0x00]), // vShieldedOutput count
    new Uint8Array([0x00]) // vJoinSplit count
  )
  return concat(...parts)
}

// ---------------------------------------------------------------------------
// Public builder API
// ---------------------------------------------------------------------------

export type BuildUtxoSendOptions = {
  chain: UtxoChainName
  fromAddress: string
  toAddress: string
  /** Amount in base units (sats, litoshi, duffs, ...) */
  amount: bigint
  /** Pre-selected UTXOs (caller handles coin-selection) */
  utxos: UtxoInput[]
  /** Fee rate in sats/byte */
  feeRate: number
  /** Compressed pubkey (33 bytes) used for scriptSig / witness */
  compressedPubKey: Uint8Array
  /**
   * Zcash consensus branch ID (ignored for non-Zcash chains). Defaults to
   * `ZCASH_BRANCH_ID_NU6_1` at the time of release. Consumers SHOULD fetch
   * the current value from a zcash-cli `getblockchaininfo` at tx-build time
   * — hardcoding means every future consensus upgrade requires a shipped
   * SDK release.
   */
  zcashBranchId?: number
}

export type UtxoTxBuilderResult = {
  /** SHA-256d preimage hashes to sign, one per input, hex-encoded (no 0x prefix) */
  signingHashesHex: string[]
  /**
   * Unsigned tx encoding for record-keeping. For P2WPKH chains this does NOT
   * include the segwit marker + witness data — it is the post-BIP143 preimage
   * shape (version || inputs || outputs || locktime), matching bitcoinjs-lib's
   * `Transaction.toBuffer(false, undefined, undefined, false)`.
   */
  unsignedRawHex: string
  /** Inputs selected by the caller, echoed for assembly */
  inputs: UtxoInput[]
  /**
   * Assemble the broadcastable signed tx. Callers pass one hex sig per input;
   * each sig is either:
   *   - 128 hex chars (r || s) — SDK DER-encodes and applies low-S, or
   *   - 130 hex chars (r || s || recovery_id) — last byte is dropped.
   */
  finalize: (sigHexes: string[]) => { rawTxHex: string; txHashHex: string }
}

/**
 * Build a UTXO native-token send transaction.
 *
 * The builder computes one sighash per input — all of which the consumer must
 * sign independently (the same keyshare for every input, but different
 * preimages). The `finalize` callback then reassembles the broadcastable tx
 * from the DER-encoded signature bytes. Coin selection, fee tuning, and
 * actual broadcasting are the caller's responsibility — see the RN bridge
 * for higher-level helpers (`getUtxos`, `estimateUtxoFee`, `broadcastUtxoTx`).
 */
export function buildUtxoSendTx(opts: BuildUtxoSendOptions): UtxoTxBuilderResult {
  const spec = UTXO_SPECS[opts.chain]
  if (!spec) throw new Error(`unsupported UTXO chain: ${opts.chain as string}`)

  const inputs = opts.utxos
  if (inputs.length === 0) throw new Error('no UTXOs provided')
  if (opts.amount <= 0n) throw new Error('amount must be greater than zero')

  const inputTotal = inputs.reduce((s, u) => s + u.value, 0n)

  // Approximate tx size for fee calc — matches app's heuristic.
  const bytesPerInput = spec.scriptType === 'p2wpkh' ? 68 : 150
  const txSize = inputs.length * bytesPerInput + 2 * 34 + 10
  const fee = BigInt(Math.ceil(txSize * opts.feeRate))
  const change = inputTotal - opts.amount - fee
  if (change < 0n) {
    throw new Error(
      `insufficient funds: have=${inputTotal} need=${opts.amount + fee} (amount=${opts.amount} fee=${fee})`
    )
  }

  const toDec = decodeAddressToPubKeyHash(opts.toAddress, opts.chain)
  const fromDec = decodeAddressToPubKeyHash(opts.fromAddress, opts.chain)
  // P2SH spending requires the redeem script in the sighash scriptCode and a
  // matching scriptSig. Vultisig vaults derive P2PKH/P2WPKH addresses only, so
  // `fromAddress` is never legitimately P2SH in production — but the decoder
  // newly accepts BCH `bitcoincash:p...` and BTC/LTC/DOGE/DASH base58 P2SH
  // (CR items #2 and #6). Without an explicit guard here the builder would
  // emit a P2PKH-shaped sighash for a P2SH input, the user signs garbage,
  // and the resulting tx fails at broadcast time. Throw fast instead.
  if (fromDec.type === 'p2sh') {
    throw new Error(
      `buildUtxoSendTx: P2SH spending is not supported (fromAddress=${opts.fromAddress}). Vultisig vaults derive P2PKH/P2WPKH addresses only.`
    )
  }
  // Cross-type guard: the address decoder is permissive (e.g. legacy `1...`
  // BTC, segwit `bc1...`, BCH cashaddr, base58 P2SH) but the chain config
  // pins exactly one `scriptType` per chain. If a caller passes an address
  // whose decoded type doesn't match the chain's expected scriptType, the
  // sighash branch chooses the WRONG sighash variant (legacy vs BIP143) and
  // emits a hash that signs garbage. Throw fast so the caller fixes the
  // address rather than silently producing an unspendable tx.
  if (fromDec.type !== spec.scriptType) {
    throw new Error(
      `buildUtxoSendTx: fromAddress decodes to ${fromDec.type} but chain ${opts.chain} expects ${spec.scriptType} ` +
        `(fromAddress=${opts.fromAddress}). Pass an address that matches the chain's scriptType.`
    )
  }
  const toScript = buildScriptPubKey(toDec.pubKeyHash, toDec.type)
  const fromScript = buildScriptPubKey(fromDec.pubKeyHash, fromDec.type)

  const { outputsWithCount, outputsRaw } = serializeOutputs(toScript, opts.amount, fromScript, change, spec.dustLimit)

  const isBCH = opts.chain === 'Bitcoin-Cash'
  const isZcash = opts.chain === 'Zcash'
  const zcashBranchId = opts.zcashBranchId ?? ZCASH_BRANCH_ID_NU6_1

  const signingHashes: Uint8Array[] = []
  for (let i = 0; i < inputs.length; i++) {
    let h: Uint8Array
    if (isZcash) {
      h = getSighashZcash(inputs, outputsRaw, i, fromDec.pubKeyHash, zcashBranchId)
    } else if (isBCH) {
      h = getSighashBIP143({
        inputs,
        outputsRaw,
        inputIndex: i,
        pubKeyHash: fromDec.pubKeyHash,
        version: 1,
        sighashType: 0x41,
      })
    } else if (spec.scriptType === 'p2pkh') {
      const senderScript = buildScriptPubKey(fromDec.pubKeyHash, 'p2pkh')
      h = getSighashLegacy({
        inputs,
        outputsWithCount,
        inputIndex: i,
        scriptPubKey: senderScript,
      })
    } else {
      h = getSighashBIP143({
        inputs,
        outputsRaw,
        inputIndex: i,
        pubKeyHash: fromDec.pubKeyHash,
        version: 2,
        sighashType: 0x01,
      })
    }
    signingHashes.push(h)
  }

  // Unsigned preimage-shape bytes: version || inputs || outputs || locktime
  const unsignedParts: Uint8Array[] = []
  const version = isZcash ? ZCASH_V4_VERSION : spec.scriptType === 'p2wpkh' && !isBCH ? 2 : 1
  unsignedParts.push(writeU32LE(version))
  if (isZcash) unsignedParts.push(writeU32LE(ZCASH_SAPLING_VERSION_GROUP_ID))
  unsignedParts.push(writeVarInt(inputs.length))
  for (const input of inputs) {
    unsignedParts.push(reverseHexBytes(input.hash), writeU32LE(input.index))
    unsignedParts.push(writeVarInt(0))
    unsignedParts.push(writeU32LE(0xffffffff))
  }
  unsignedParts.push(outputsWithCount, writeU32LE(0))
  if (isZcash) {
    unsignedParts.push(
      writeU32LE(0), // nExpiryHeight
      writeU64LE(0n), // valueBalance
      new Uint8Array([0x00, 0x00, 0x00]) // vShielded{Spend,Output,JoinSplit}
    )
  }
  const unsignedRawHex = bytesToHex(concat(...unsignedParts))

  const finalize = (sigHexes: string[]): { rawTxHex: string; txHashHex: string } => {
    if (sigHexes.length !== inputs.length) {
      throw new Error(`expected ${inputs.length} signatures, got ${sigHexes.length}`)
    }
    const sigs: Uint8Array[] = sigHexes.map(raw => {
      const clean = raw.startsWith('0x') ? raw.slice(2) : raw
      if (clean.length !== 128 && clean.length !== 130) {
        throw new Error(`signature must be 128 or 130 hex chars (r||s[||v]), got ${clean.length}`)
      }
      return derEncodeRS(clean.substring(0, 64), clean.substring(64, 128))
    })

    let rawTx: Uint8Array
    // txid is computed from the BIP141 "base" form — version || inputs ||
    // outputs || locktime — with no segwit marker, flag, or witness stack.
    // For P2PKH / BCH / Zcash the broadcastable bytes are already in that
    // shape, so we just hash `rawTx`. For P2WPKH we must serialize the
    // witness-stripped form explicitly; using the broadcastable bytes would
    // yield the wtxid, which callers can't look up on block explorers.
    let baseTxForTxid: Uint8Array
    if (isZcash) {
      rawTx = assembleZcashTx(inputs, sigs, opts.compressedPubKey, outputsWithCount)
      baseTxForTxid = rawTx
    } else if (spec.scriptType === 'p2pkh') {
      rawTx = assembleP2pkhTx(inputs, sigs, opts.compressedPubKey, outputsWithCount, isBCH ? 0x41 : 0x01)
      baseTxForTxid = rawTx
    } else {
      rawTx = assembleP2wpkhTx(inputs, sigs, opts.compressedPubKey, outputsWithCount)
      baseTxForTxid = serializeP2wpkhBaseTx(inputs, outputsWithCount)
    }
    const rawTxHex = bytesToHex(rawTx)
    // txid = reverseHex(sha256d(baseTx)) per BIP141. The reverse is because
    // Bitcoin displays txids in "big-endian" byte order but hashes them in
    // little-endian internally.
    const txHashHex = bytesToHex(doubleSha256(baseTxForTxid).reverse())
    return { rawTxHex, txHashHex }
  }

  return {
    signingHashesHex: signingHashes.map(bytesToHex),
    unsignedRawHex,
    inputs,
    finalize,
  }
}
