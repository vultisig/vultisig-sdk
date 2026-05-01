/**
 * Tron transaction builders (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/tronTx.ts but split into pure
 * primitive functions that don't reach back into any vault / MPC layer.
 * Callers produce the tx, sign it outside, then call `finalize(sigHex)` to
 * get the broadcastable hex.
 *
 * Covered surface:
 *   - `buildTronSendTx`        — native TRX transfer (TransferContract, type=1)
 *   - `buildTrc20TransferTx`   — TRC-20 token transfer (TriggerSmartContract, type=31)
 *
 * Tron tx format:
 *   Transaction {
 *     raw_data: Raw {
 *       ref_block_bytes:  bytes  (field 1, last 2 bytes of block number, BE)
 *       ref_block_hash:   bytes  (field 4, bytes 8..16 of block id hash)
 *       expiration:       int64  (field 8, unix ms)
 *       contract:         Contract[] (field 11)
 *       timestamp:        int64  (field 14, unix ms)
 *       fee_limit:        int64  (field 18, optional, only for TRC-20)
 *     }
 *     signature: bytes          (field 2, 65-byte r||s||v)
 *   }
 *
 *   Contract { type: int32 (field 1), parameter: Any (field 2) }
 *   Any      { type_url: string (field 1), value: bytes (field 2) }
 *
 *   TransferContract {
 *     owner_address: bytes (field 1)   // 21 bytes: 0x41 || keccak(pub)[-20]
 *     to_address:    bytes (field 2)
 *     amount:        int64 (field 3)
 *   }
 *
 *   TriggerSmartContract {
 *     owner_address:    bytes (field 1)
 *     contract_address: bytes (field 2)
 *     call_value:       int64 (field 3)   // 0 for TRC-20 transfer
 *     data:             bytes (field 4)   // 4-byte selector || 32-byte addr || 32-byte amount
 *   }
 *
 * Signing hash = SHA-256(rawDataBytes) per Tron's `signtransaction` behaviour.
 * Signature is expected as 65 bytes (r||s||v). `finalize()` wraps the raw
 * tx + signature into the outer Transaction protobuf.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import bs58check from 'bs58check'

import { concatProtoBytes, fieldBytes, fieldInt64, fieldString, fieldVarint } from './proto'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TronTxBuilderResult = {
  /** SHA-256 of the `raw_data` bytes, hex — pass to `fastVaultSign`. */
  signingHashHex: string
  /** `raw_data` bytes, hex — useful for debugging / on-chain replay. */
  unsignedRawHex: string
  /** Wrap the raw tx with a signature to produce the broadcast payload. */
  finalize: (signatureHex: string) => { signedTxHex: string; txId: string }
}

export type BuildTronSendOptions = {
  /** Sender Tron address (base58check, e.g. `T...`). */
  from: string
  /** Recipient Tron address. */
  to: string
  /** Amount in SUN (1 TRX = 1_000_000 SUN). */
  amount: bigint
  /**
   * ref_block_bytes — last 2 bytes of the chosen block number, big-endian.
   * Fetch via `getTronBlockRefs` or derive from `block_header.raw_data.number`.
   */
  refBlockBytes: Uint8Array
  /**
   * ref_block_hash — bytes 8..16 of the block id (i.e. `blockID.substring(16, 32)`
   * decoded from hex to bytes).
   */
  refBlockHash: Uint8Array
  /**
   * Expiration unix timestamp (ms). Required — callers typically compute as
   * `timestamp + 60_000n` at build time so replay windows stay short.
   */
  expiration: bigint
  /** Transaction timestamp (ms). Required — typically `BigInt(Date.now())`. */
  timestamp: bigint
}

export type BuildTrc20TransferOptions = {
  /** Sender Tron address. */
  from: string
  /** Recipient Tron address. */
  to: string
  /** TRC-20 token contract address (Tron base58check). */
  tokenAddress: string
  /** Token amount in smallest units. */
  amount: bigint
  /**
   * Fee limit in SUN. Required by Tron for contract calls; typical value is
   * ~100 TRX (100_000_000n SUN) for TRC-20 transfers. Must be > 0n — a zero
   * feeLimit would be silently dropped from the raw data, causing the node to
   * reject the tx with a cryptic OUT_OF_ENERGY error.
   */
  feeLimit: bigint
  /** ref_block_bytes — see `BuildTronSendOptions`. */
  refBlockBytes: Uint8Array
  /** ref_block_hash — see `BuildTronSendOptions`. */
  refBlockHash: Uint8Array
  /** Expiration (ms). Required — see `BuildTronSendOptions`. */
  expiration: bigint
  /** Timestamp (ms). Required — see `BuildTronSendOptions`. */
  timestamp: bigint
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, '0')
  }
  return out
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) {
    throw new Error(`invalid hex length: ${clean.length}`)
  }
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Decode a Tron base58check address to its raw 21-byte form
 * (prefix 0x41 + 20-byte keccak hash of the pubkey).
 *
 * Tron's protobuf carries addresses as raw bytes, not the base58check string.
 */
export function tronAddressToBytes(address: string): Uint8Array {
  // `bs58check` v4 published both named and default exports; handle both.

  const mod = bs58check as unknown as { decode?: (s: string) => Uint8Array } & {
    default?: { decode: (s: string) => Uint8Array }
  }
  const decode = mod.decode ?? mod.default?.decode
  if (!decode) throw new Error('bs58check.decode unavailable')
  const bytes = decode(address)
  if (bytes.length !== 21 || bytes[0] !== 0x41) {
    throw new Error(`invalid Tron address: ${address} (length=${bytes.length})`)
  }
  return bytes
}

// ---------------------------------------------------------------------------
// Inner contract messages
// ---------------------------------------------------------------------------

function buildTransferContract(from: string, to: string, amount: bigint): Uint8Array {
  // Zero-amount sends are allowed on Tron (would appear as a dust/memo-like
  // tx) but negative amounts never are. Validate here so the mistake fails
  // loudly rather than silently producing a non-standard int64 encoding.
  if (amount < 0n) throw new Error(`amount must be non-negative, got ${amount}`)
  return concatProtoBytes(
    fieldBytes(1, tronAddressToBytes(from)),
    fieldBytes(2, tronAddressToBytes(to)),
    fieldInt64(3, amount)
  )
}

export function buildTrc20CallData(to: string, amount: bigint): Uint8Array {
  // ERC-20 `transfer(address,uint256)` selector is 0xa9059cbb.
  const SELECTOR = new Uint8Array([0xa9, 0x05, 0x9c, 0xbb])

  // Param 1: recipient address, ABI-encoded as uint256 (left-padded 32 bytes).
  // Tron addresses are EVM-style in the low 20 bytes — decode the base58check
  // form (21 bytes prefix-0x41 + 20-byte hash), drop the 0x41 prefix, then
  // left-pad with 12 zero bytes.
  const toRaw = tronAddressToBytes(to)
  const addrParam = new Uint8Array(32)
  addrParam.set(toRaw.subarray(1), 12)

  // Param 2: amount, ABI-encoded as uint256 (big-endian 32 bytes).
  if (amount < 0n) throw new Error(`amount must be non-negative, got ${amount}`)
  if (amount > (1n << 256n) - 1n) {
    throw new Error(`amount exceeds uint256, got ${amount}`)
  }
  const amountParam = new Uint8Array(32)
  let v = amount
  for (let i = 31; i >= 0; i--) {
    amountParam[i] = Number(v & 0xffn)
    v >>= 8n
  }

  const out = new Uint8Array(4 + 32 + 32)
  out.set(SELECTOR, 0)
  out.set(addrParam, 4)
  out.set(amountParam, 36)
  return out
}

function buildTriggerSmartContract(from: string, tokenAddress: string, callData: Uint8Array): Uint8Array {
  return concatProtoBytes(
    fieldBytes(1, tronAddressToBytes(from)),
    fieldBytes(2, tronAddressToBytes(tokenAddress)),
    fieldInt64(3, 0n), // call_value — must be 0 for TRC-20 transfers
    fieldBytes(4, callData)
  )
}

// ---------------------------------------------------------------------------
// Raw / Transaction assembly
// ---------------------------------------------------------------------------

function buildRawData(opts: {
  refBlockBytes: Uint8Array
  refBlockHash: Uint8Array
  expiration: bigint
  timestamp: bigint
  contractType: number
  contractTypeUrl: string
  contractValue: Uint8Array
  feeLimit?: bigint
}): Uint8Array {
  // `google.protobuf.Any` wrapper: { type_url (1), value (2) }.
  const anyParam = concatProtoBytes(fieldString(1, opts.contractTypeUrl), fieldBytes(2, opts.contractValue))

  // `Contract { type (1), parameter (2) }`.
  const contract = concatProtoBytes(fieldVarint(1, opts.contractType), fieldBytes(2, anyParam))

  // Raw: we write the fields in ascending field-number order as Tron does.
  // The spec allows any order, but tronweb/core emit this exact ordering, so
  // matching it helps byte parity checks against external signers.
  let raw = concatProtoBytes(
    fieldBytes(1, opts.refBlockBytes),
    fieldBytes(4, opts.refBlockHash),
    fieldInt64(8, opts.expiration),
    fieldBytes(11, contract),
    fieldInt64(14, opts.timestamp)
  )

  if (opts.feeLimit != null && opts.feeLimit > 0n) {
    raw = concatProtoBytes(raw, fieldInt64(18, opts.feeLimit))
  }

  return raw
}

function wrapTransaction(rawData: Uint8Array, signature: Uint8Array): Uint8Array {
  return concatProtoBytes(fieldBytes(1, rawData), fieldBytes(2, signature))
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

function parseSignature(sigHex: string): Uint8Array {
  const bytes = hexToBytes(sigHex)
  if (bytes.length !== 65) {
    throw new Error(`expected 65-byte signature (r||s||v), got ${bytes.length}`)
  }
  return bytes
}

function validateRefs(refBlockBytes: Uint8Array, refBlockHash: Uint8Array): void {
  if (refBlockBytes.length !== 2) {
    throw new Error(`refBlockBytes must be 2 bytes, got ${refBlockBytes.length}`)
  }
  if (refBlockHash.length !== 8) {
    throw new Error(`refBlockHash must be 8 bytes, got ${refBlockHash.length}`)
  }
}

export function buildTronSendTx(opts: BuildTronSendOptions): TronTxBuilderResult {
  validateRefs(opts.refBlockBytes, opts.refBlockHash)
  const contractValue = buildTransferContract(opts.from, opts.to, opts.amount)
  const rawData = buildRawData({
    refBlockBytes: opts.refBlockBytes,
    refBlockHash: opts.refBlockHash,
    expiration: opts.expiration,
    timestamp: opts.timestamp,
    contractType: 1,
    contractTypeUrl: 'type.googleapis.com/protocol.TransferContract',
    contractValue,
  })

  const signingHashBytes = sha256(rawData)
  const signingHashHex = bytesToHex(signingHashBytes)
  const unsignedRawHex = bytesToHex(rawData)

  const finalize = (sigHex: string): { signedTxHex: string; txId: string } => {
    const sig = parseSignature(sigHex)
    const signedTx = wrapTransaction(rawData, sig)
    return { signedTxHex: bytesToHex(signedTx), txId: signingHashHex }
  }

  return { signingHashHex, unsignedRawHex, finalize }
}

export function buildTrc20TransferTx(opts: BuildTrc20TransferOptions): TronTxBuilderResult {
  validateRefs(opts.refBlockBytes, opts.refBlockHash)
  // feeLimit must be > 0 — buildRawData silently drops a zero feeLimit, and a
  // TRC-20 TriggerSmartContract with no fee_limit is rejected by TronGrid with
  // OUT_OF_ENERGY. Reject loudly so the caller sees the error here, not after
  // broadcast.
  if (opts.feeLimit <= 0n) {
    throw new Error(`buildTrc20TransferTx: feeLimit must be > 0, got ${opts.feeLimit}`)
  }
  const callData = buildTrc20CallData(opts.to, opts.amount)
  const contractValue = buildTriggerSmartContract(opts.from, opts.tokenAddress, callData)
  const rawData = buildRawData({
    refBlockBytes: opts.refBlockBytes,
    refBlockHash: opts.refBlockHash,
    expiration: opts.expiration,
    timestamp: opts.timestamp,
    contractType: 31,
    contractTypeUrl: 'type.googleapis.com/protocol.TriggerSmartContract',
    contractValue,
    feeLimit: opts.feeLimit,
  })

  const signingHashBytes = sha256(rawData)
  const signingHashHex = bytesToHex(signingHashBytes)
  const unsignedRawHex = bytesToHex(rawData)

  const finalize = (sigHex: string): { signedTxHex: string; txId: string } => {
    const sig = parseSignature(sigHex)
    const signedTx = wrapTransaction(rawData, sig)
    return { signedTxHex: bytesToHex(signedTx), txId: signingHashHex }
  }

  return { signingHashHex, unsignedRawHex, finalize }
}
