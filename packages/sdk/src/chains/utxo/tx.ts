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
 *   - `getSighashZcash(...)` — standalone ZIP-243 Zcash transparent sighash.
 *   - `decodeAddressToPubKeyHash(addr, chain)` — address → {pubKeyHash, type}.
 */
import { secp256k1 as secp } from '@noble/curves/secp256k1.js'
import { blake2b } from '@noble/hashes/blake2.js'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256, sha512 } from '@noble/hashes/sha2.js'
import { bech32 } from '@scure/base'
import { getZcashConventionalFee } from '@vultisig/core-chain/chains/utxo/fee/zip317'
import bs58check from 'bs58check'

import { CASHADDR_CHARSET, verifyCashAddrChecksum } from '../../utils/cashaddr'

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
  // UTXO-02 (audit r2): LTC's DUST_RELAY_TX_FEE is ~10x BTC's -> real P2WPKH dust ~2_940 litoshi, not 1_000.
  // At 1_000 a 1_001..2_939 change output is non-standard dust that can stall the tx. KEEP IN SYNC with
  // packages/core/chain/chains/utxo/minUtxo.ts (minUtxo[Chain.Litecoin]).
  Litecoin: { scriptType: 'p2wpkh', dustLimit: 2_940n, slip44: 2, bipPurpose: 84 },
  Dogecoin: { scriptType: 'p2pkh', dustLimit: 1_000_000n, slip44: 3, bipPurpose: 44 },
  'Bitcoin-Cash': { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 145, bipPurpose: 44 },
  Dash: { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 5, bipPurpose: 44 },
  Zcash: { scriptType: 'p2pkh', dustLimit: 1_000n, slip44: 133, bipPurpose: 44 },
}

export const getUtxoChainSpec = (chain: UtxoChainName): UtxoChainSpec => UTXO_SPECS[chain]

/**
 * Per-chain minimum relay fee rate, in that chain's own base-unit per vByte
 * (sat/vB, litoshi/vB, koinu/vB, duff/vB). A caller-supplied `feeRate` below
 * this is silently non-standard/non-relayable on that chain's real network —
 * BTC-reasonable rates are fine on BTC/LTC/BCH/Dash but drastically underpay
 * Dogecoin, whose coin value is orders of magnitude lower. This is a FLOOR:
 * it only raises a too-low feeRate, never lowers a normal/high one (no
 * overpaying a legitimate rate).
 *
 * Sourced from each chain's own Core `DEFAULT_MIN_RELAY_TX_FEE` (expressed
 * per kvB there; divided by 1000 for the per-byte value used here):
 *   - Bitcoin:      1,000 sat/kvB   -> 1 sat/vB
 *     (bitcoin/bitcoin src/policy/policy.h DEFAULT_MIN_RELAY_TX_FEE)
 *   - Litecoin:     1,000 litoshi/kvB -> 1 litoshi/vB (same order as BTC —
 *     LTC's DUST_RELAY_TX_FEE is ~10x BTC's, but its min RELAY fee is not)
 *     (litecoin-project/litecoin src/validation.h DEFAULT_MIN_RELAY_TX_FEE)
 *   - Dogecoin:     1,000,000 koinu/kvB -> 1,000 koinu/vB. We floor at DOGE's
 *     DEFAULT_BLOCK_MIN_TX_FEE (RECOMMENDED_MIN_TX_FEE = COIN/100 = 1,000
 *     koinu/vB), the default MINER block-INCLUSION threshold — NOT the lower
 *     DEFAULT_MIN_RELAY_TX_FEE (=RECOMMENDED/10 = 100 koinu/vB). A tx at the
 *     relay-min RELAYS but can sit unmined under default miner config (the same
 *     "stuck" symptom one layer down), so we floor at the inclusion minimum.
 *     (dogecoin/dogecoin src/validation.h + src/policy/policy.h)
 *   - Bitcoin-Cash: 1,000 sat/kvB   -> 1 sat/vB
 *     (Bitcoin-ABC / bitcoin-cash-node src/policy/policy.h
 *     DEFAULT_MIN_RELAY_TX_FEE_PER_KB)
 *   - Dash:         1,000 duff/kvB  -> 1 duff/vB
 *     (dashpay/dash src/policy/policy.h DEFAULT_MIN_RELAY_TX_FEE)
 *   - Zcash:        unused — Zcash's floor is the absolute ZIP-317
 *     conventional fee compared against the size-based fee below, not a
 *     per-byte relay minimum. Kept at 1 so indexing this map is total.
 */
const UTXO_MIN_FEE_RATE: Record<UtxoChainName, number> = {
  Bitcoin: 1,
  Litecoin: 1,
  Dogecoin: 1000,
  'Bitcoin-Cash': 1,
  Dash: 1,
  Zcash: 1,
}

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

// cashAddrPolymod / verifyCashAddrChecksum / CASHADDR_CHARSET now live in
// ../../utils/cashaddr (shared with the isAddressValidForChain fund-safety
// gate, so both agree on what a valid BCH address is).

export type DecodedAddress = {
  pubKeyHash: Uint8Array
  type: UtxoScriptKind
}

const P2SH_BASE58_VERSIONS = new Set<number>([0x05, 0x32, 0x16, 0x10])

function decodeBech32Address(address: string): DecodedAddress | undefined {
  let bech32Decoded: ReturnType<typeof bech32.decode> | undefined
  try {
    bech32Decoded = bech32.decode(address as `${string}1${string}`)
  } catch {
    return undefined
  }

  if (bech32Decoded.words[0] !== 0) return undefined

  const program = new Uint8Array(bech32.fromWords(bech32Decoded.words.slice(1)))
  if (program.length === 20) return { pubKeyHash: program, type: 'p2wpkh' }
  if (program.length === 32) {
    throw new Error(`Cannot decode address: ${address} — P2WSH (32-byte witness v0) is not supported by this SDK build`)
  }
  throw new Error(`Cannot decode address: ${address} — unexpected witness v0 program length ${program.length}`)
}

function cashAddrPayloadToBytes(payload5: number[]): number[] {
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
  return result
}

function decodeCashAddrAddress(address: string): DecodedAddress | undefined {
  try {
    const cashAddr = address.includes(':') ? address : `bitcoincash:${address}`
    const [prefix, payload] = cashAddr.split(':') as [string, string]
    if (prefix !== 'bitcoincash' || !payload) return undefined

    const data5: number[] = []
    for (const c of payload) {
      const idx = CASHADDR_CHARSET.indexOf(c)
      if (idx === -1) throw new Error('invalid cashaddr char')
      data5.push(idx)
    }
    // Verify the polymod checksum BEFORE stripping it. Skipping this step
    // means any mistyped address with valid base32 chars decodes to a
    // garbage pubKeyHash and the tx is signed to an address the user
    // never intended. Reference:
    //   https://reference.cash/protocol/blockchain/encoding/cashaddr
    if (!verifyCashAddrChecksum(prefix, data5)) throw new Error('CashAddr checksum mismatch')

    const result = cashAddrPayloadToBytes(data5.slice(0, -8))
    if (result.length < 21) return undefined
    if (result[0] === 0x00) return { pubKeyHash: new Uint8Array(result.slice(1, 21)), type: 'p2pkh' }
    if (result[0] === 0x08) return { pubKeyHash: new Uint8Array(result.slice(1, 21)), type: 'p2sh' }
  } catch {
    /* not cashaddr */
  }

  return undefined
}

function decodeBase58Address(address: string, chain: UtxoChainName): DecodedAddress | undefined {
  let decoded: Uint8Array | undefined
  try {
    decoded = bs58check.decode(address)
  } catch {
    return undefined
  }

  // Zcash t-addresses use a 2-byte version prefix:
  //   0x1c, 0xb8 → t1... (P2PKH)
  //   0x1c, 0xbd → t3... (P2SH)
  if (chain === 'Zcash' && decoded.length === 22 && decoded[0] === 0x1c) {
    if (decoded[1] === 0xb8) return { pubKeyHash: decoded.slice(2), type: 'p2pkh' }
    if (decoded[1] === 0xbd) return { pubKeyHash: decoded.slice(2), type: 'p2sh' }
  }

  const version = decoded[0]
  const type: UtxoScriptKind = P2SH_BASE58_VERSIONS.has(version!) ? 'p2sh' : 'p2pkh'
  const pubKeyHash = decoded.slice(1)
  if (pubKeyHash.length !== 20) {
    throw new Error(
      `Cannot decode address: ${address} — payload length ${pubKeyHash.length} bytes for chain ${chain} (expected 20)`
    )
  }
  return { pubKeyHash, type }
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
  const bech32Decoded = decodeBech32Address(address)
  if (bech32Decoded) return bech32Decoded

  // CashAddr (BCH bitcoincash:q...)
  const cashAddrDecoded = decodeCashAddrAddress(address)
  if (cashAddrDecoded) return cashAddrDecoded

  // base58check (DOGE D..., Zcash t1..., legacy BTC 1...)
  // Decode the base58check payload OUTSIDE the chain-specific branching so we
  // can distinguish "not a base58check string" (fall through to bottom-of-fn
  // throw) from "decoded fine but payload length doesn't match a 20-byte
  // pubKeyHash" (raise an explicit, chain-aware error). Burying the latter
  // under a generic catch silently re-routes wrong-chain-paste cases (e.g. a
  // 22-byte Zcash t-address under chain='Dogecoin') back to the same vague
  // "Cannot decode address" message instead of surfacing the length mismatch.
  const base58Decoded = decodeBase58Address(address, chain)
  if (base58Decoded) return base58Decoded

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
 * Zcash consensus branch ID for NU6.1. Kept exported for callers that need
 * to reproduce transactions from the previous consensus epoch.
 */
export const ZCASH_BRANCH_ID_NU6_1 = 0x4dec4df0

/**
 * Zcash consensus branch ID for NU6.2. Kept exported only for callers that
 * need to reproduce historical transactions from that consensus epoch.
 */
export const ZCASH_BRANCH_ID_NU6_2 = 0x5437f330
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

/**
 * ZIP-243 sighash for Zcash's v4 Sapling-framed transparent send path
 * (BLAKE2b personalization, consensus-branch-id-parametrized). Exported
 * (alongside `getSighashBIP143` / `getSighashLegacy`) so golden-vector tests
 * can pin it directly against an authoritative reference implementation,
 * independent of `buildUtxoSendTx`'s fee/address-decoding logic.
 *
 * NARROW CONTRACT — this is a public primitive with NO input validation, and
 * `buildUtxoSendTx` (not this function) is what enforces the preconditions
 * below. Calling it outside them yields a deterministic but WRONG digest, i.e.
 * a signature over a message the network will reject (or, worse, a signature
 * the caller believes it verified). It hardcodes:
 *   - transparent-only v4/Sapling framing (no JoinSplit/Sapling/Orchard bundle)
 *   - `nHashType = SIGHASH_ALL` (1) — no NONE/SINGLE/ANYONECANPAY
 *   - `nLockTime = 0`, `nExpiryHeight = 0`, `valueBalance = 0`
 *   - `nSequence = 0xffffffff` on every input
 *   - a P2PKH `scriptCode` built from `pubKeyHash` — a P2SH/P2WPKH input hash
 *     silently produces an unspendable sighash (see the `p2sh` guard in
 *     `buildUtxoSendTx`)
 * `outputsRaw` MUST be the bare concatenation of serialized txouts with NO
 * leading varint count (that's `outputsWithCount`, a different value).
 * `inputIndex` MUST be in range for `inputs`.
 */
export function getSighashZcash(
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

const OP_RETURN = 0x6a
const OP_PUSHDATA1 = 0x4c
// Standard-relay cap on OP_RETURN payload size. THORChain swap-quote memos fit
// comfortably within this; anything larger would be non-standard and rejected
// by relaying nodes, so we fail loud instead of building an unbroadcastable tx.
const MAX_OP_RETURN_DATA = 80

/**
 * Build an OP_RETURN scriptPubKey embedding `data` (e.g. a THORChain swap memo):
 *   len <= 75      -> OP_RETURN <len> <data>            (direct push)
 *   76 <= len <= 80 -> OP_RETURN OP_PUSHDATA1 <len> <data>
 * Throws for len > 80 (non-standard).
 */
function buildOpReturnScript(data: Uint8Array): Uint8Array {
  if (data.length === 0) {
    // Fail loud: an empty memo (e.g. from an upstream `opReturnData: ''` bug)
    // would otherwise build a useless `6a 00` output and ship a THORChain
    // deposit with NO routing data — the funds land at the inbound vault
    // unroutable/stuck. Skipping the output is equally unsafe for a swap (a
    // memo-less deposit is still unroutable), so we reject rather than skip.
    throw new Error(
      'OP_RETURN data is empty: a UTXO THORChain swap needs a non-empty memo to route the deposit. Refusing to build a memo-less (unroutable) transaction.'
    )
  }
  if (data.length > MAX_OP_RETURN_DATA) {
    throw new Error(
      `OP_RETURN data too large: ${data.length} bytes (max ${MAX_OP_RETURN_DATA}). THORChain swap memos fit within this cap.`
    )
  }
  if (data.length <= 75) {
    return concat(new Uint8Array([OP_RETURN, data.length]), data)
  }
  return concat(new Uint8Array([OP_RETURN, OP_PUSHDATA1, data.length]), data)
}

/**
 * Estimate the network fee (base units) `buildUtxoSendTx` will charge for a
 * tx with `inputCount` inputs at `feeRate` sats/byte, optionally carrying an
 * OP_RETURN memo. Factored out of `buildUtxoSendTx` so a coin-selection
 * layer (see `select.ts`) can predict the SAME fee the builder will compute
 * for a given input count — selection and build must agree on the formula,
 * or "insufficient funds" / change-below-dust outcomes can diverge between
 * the two steps (UTXO-01).
 */
export function estimateUtxoTxFee(
  chain: UtxoChainName,
  inputCount: number,
  feeRate: number,
  opReturnData?: string
): bigint {
  const spec = UTXO_SPECS[chain]
  if (!spec) throw new Error(`unsupported UTXO chain: ${chain as string}`)
  const opReturnScript =
    opReturnData !== undefined ? buildOpReturnScript(new TextEncoder().encode(opReturnData)) : undefined
  // Approximate tx size for fee calc — matches app's heuristic.
  const bytesPerInput = spec.scriptType === 'p2wpkh' ? 68 : 150
  // 8-byte value + varint(scriptLen) + scriptLen; scriptLen <= 82 so the varint is 1 byte.
  const opReturnBytes = opReturnScript ? 9 + opReturnScript.length : 0
  const txSize = inputCount * bytesPerInput + 2 * 34 + 10 + opReturnBytes
  // UTXO-03: raise to chain min-relay-fee floor (most acute on Dogecoin) so
  // selectUtxoInputs and buildUtxoSendTx agree on the same effective rate.
  const effectiveFeeRate = Math.max(feeRate, UTXO_MIN_FEE_RATE[chain])
  const sizeFee = BigInt(Math.ceil(txSize * effectiveFeeRate))
  // UTXO-04: canonical ZIP-317 action-count formula with actual output sizes.
  const zip317OutputSizes = opReturnScript ? [34n, 34n, BigInt(opReturnBytes)] : [34n, 34n]
  const zip317Floor = chain === 'Zcash' ? getZcashConventionalFee({ inputCount, outputSizes: zip317OutputSizes }) : 0n
  return sizeFee > zip317Floor ? sizeFee : zip317Floor
}

function serializeOutputs(
  toScriptPubKey: Uint8Array,
  amount: bigint,
  changeScriptPubKey: Uint8Array | null,
  change: bigint,
  dustLimit: bigint,
  opReturnScript?: Uint8Array
): { outputsWithCount: Uint8Array; outputsRaw: Uint8Array } {
  const hasChange = changeScriptPubKey && change > dustLimit
  let numOutputs = 1
  if (hasChange) numOutputs++
  if (opReturnScript) numOutputs++
  const parts: Uint8Array[] = []
  parts.push(writeU64LE(amount), writeVarInt(toScriptPubKey.length), toScriptPubKey)
  if (hasChange && changeScriptPubKey) {
    parts.push(writeU64LE(change), writeVarInt(changeScriptPubKey.length), changeScriptPubKey)
  }
  // OP_RETURN is a separate 0-value output appended LAST — the recipient (vault)
  // output keeps the full amount; the fee comes from inputs/change, never by
  // shaving the vault output. It sits in outputsRaw + outputsWithCount so every
  // sighash variant commits to the memo (see call sites below).
  if (opReturnScript) {
    parts.push(writeU64LE(0n), writeVarInt(opReturnScript.length), opReturnScript)
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
   * Zcash consensus branch ID (ignored for non-Zcash chains). Required for
   * Zcash so future consensus upgrades fail loud instead of signing with a
   * stale compiled fallback.
   */
  zcashBranchId?: number
  /**
   * Optional UTF-8 data (typically a THORChain swap memo) embedded on-chain as
   * a trailing 0-value OP_RETURN output. Standard-relay policy caps this at 80
   * bytes; longer memos throw. The memo feeds the sighash outputs digest, so
   * every input signature commits to it — the signed tx cannot be rebroadcast
   * with the memo stripped or altered. Required for UTXO THORChain swaps
   * (DOGE/BTC/LTC/BCH): without it THORChain can't route the deposit.
   */
  opReturnData?: string
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

  // Validate the address types BEFORE any fee/funding math so an unsupported or
  // mismatched `fromAddress` fails fast with the meaningful error (P2SH not
  // supported / scriptType mismatch) rather than a misleading "insufficient
  // funds" — a raised per-chain min-fee floor (UTXO-03, most acute on Dogecoin)
  // can push the required fee above the inputs and mask the real problem.
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

  // Build the OP_RETURN script up front (throws early on >80 bytes) so its size
  // feeds fee calc and its bytes feed serializeOutputs / the sighash digest.
  const opReturnScript =
    opts.opReturnData !== undefined ? buildOpReturnScript(new TextEncoder().encode(opts.opReturnData)) : undefined

  // Approximate tx size for fee calc — matches app's heuristic.
  const bytesPerInput = spec.scriptType === 'p2wpkh' ? 68 : 150
  // 8-byte value + varint(scriptLen) + scriptLen; scriptLen <= 82 so the varint is 1 byte.
  const opReturnBytes = opReturnScript ? 9 + opReturnScript.length : 0
  const txSize = inputs.length * bytesPerInput + 2 * 34 + 10 + opReturnBytes
  // UTXO-03: a caller-supplied feeRate below the chain's real min-relay-fee
  // silently produces a stuck/non-relayable tx (most acute on Dogecoin, whose
  // min relay fee is ~100x Bitcoin's). Raise — never lower — to the floor.
  const effectiveFeeRate = Math.max(opts.feeRate, UTXO_MIN_FEE_RATE[opts.chain])
  const sizeFee = BigInt(Math.ceil(txSize * effectiveFeeRate))
  // UTXO-04: use the canonical ZIP-317 action-count formula (max of input vs
  // output actions) instead of a local input-only count, so a large memo or
  // extra outputs aren't under-counted. Output sizes mirror the same
  // recipient + change P2PKH (34 bytes each) + optional OP_RETURN shape
  // assumed by the txSize estimate above.
  const zip317OutputSizes = opReturnScript ? [34n, 34n, BigInt(opReturnBytes)] : [34n, 34n]
  const zip317Floor =
    opts.chain === 'Zcash' ? getZcashConventionalFee({ inputCount: inputs.length, outputSizes: zip317OutputSizes }) : 0n
  const fee = sizeFee > zip317Floor ? sizeFee : zip317Floor
  const change = inputTotal - opts.amount - fee
  if (change < 0n) {
    throw new Error(
      `insufficient funds: have=${inputTotal} need=${opts.amount + fee} (amount=${opts.amount} fee=${fee})`
    )
  }

  const toScript = buildScriptPubKey(toDec.pubKeyHash, toDec.type)
  const fromScript = buildScriptPubKey(fromDec.pubKeyHash, fromDec.type)

  const { outputsWithCount, outputsRaw } = serializeOutputs(
    toScript,
    opts.amount,
    fromScript,
    change,
    spec.dustLimit,
    opReturnScript
  )

  const isBCH = opts.chain === 'Bitcoin-Cash'
  const isZcash = opts.chain === 'Zcash'
  const zcashBranchId = opts.zcashBranchId
  if (isZcash && zcashBranchId === undefined) {
    throw new Error('buildUtxoSendTx: zcashBranchId is required for Zcash')
  }

  const signingHashes: Uint8Array[] = []
  for (let i = 0; i < inputs.length; i++) {
    let h: Uint8Array
    if (isZcash) {
      h = getSighashZcash(inputs, outputsRaw, i, fromDec.pubKeyHash, zcashBranchId!)
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
