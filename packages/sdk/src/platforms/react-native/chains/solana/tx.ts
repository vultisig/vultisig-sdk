/**
 * Solana transaction encoding primitives (RN-safe).
 *
 * `@solana/web3.js` top-level imports `rpc-websockets` (which `import 'ws'` at
 * module init) plus `jayson`, `node-fetch`, `http`, `https`. Importing ANY
 * symbol from the barrel — even just `Transaction` or `PublicKey` — pulls the
 * entire graph into the bundle, and Hermes hangs `sdk.initialize()` on the
 * first module eval because `ws` is shimmed. There is no published subpath
 * export, so the only way to build a Solana tx on RN without the cascade is
 * to reimplement the minimal wire format.
 *
 * Scope: what `buildSolanaSendTx` produces here is a legacy (non-v0) message
 * with exactly one `SystemProgram::Transfer` instruction, fee payer = sender.
 * That covers 100% of the native-SOL send flow the app exposes. SPL-token
 * transfers still route through the core flow (TrustWallet-core signing
 * input + `@solana/web3.js` via dynamic import inside `spl/*` helpers) —
 * they require token-account derivation which stays core-owned.
 *
 * Serialization follows the Solana Transaction wire format:
 *   unsigned raw = message bytes =
 *     [header: 3 bytes]
 *     [shortvec: numKeys][accountKeys: N × 32]
 *     [recentBlockhash: 32]
 *     [shortvec: numInstructions]
 *     [per instruction: programIdIndex: u8, shortvec accountsIndexes, shortvec data]
 *   header = [numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned]
 *
 * Signed tx = [shortvec: numSigs][sig × 64] || messageBytes
 * Signing hash = message bytes verbatim (ed25519 signs the full message).
 */

import bs58 from 'bs58'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SolanaTxBuilderResult = {
  /** Message bytes — base64. Pass to keysign (ed25519 signs this verbatim). */
  signingHashHex: string
  /** Unsigned serialized message bytes, hex (for record-keeping/debugging). */
  unsignedRawHex: string
  /**
   * Given the hex-encoded raw signature (64-byte ed25519 sig = 128 hex chars),
   * return the broadcastable tx serialized as base64 for JSON-RPC.
   */
  finalize: (sigHex: string) => { rawTxBase64: string; signature: string }
}

export type BuildSolanaSendOptions = {
  /** Sender / fee payer pubkey, base58. */
  from: string
  /** Recipient pubkey, base58. */
  to: string
  /** Native SOL amount in lamports. */
  lamports: bigint
  /** Recent blockhash, base58 — fetch via `getSolanaRecentBlockhash` if unknown. */
  recentBlockhash: string
}

// ---------------------------------------------------------------------------
// Wire format helpers
// ---------------------------------------------------------------------------

// SystemProgram address = '11111111111111111111111111111111' = 32 zero bytes
const SYSTEM_PROGRAM_ID_BYTES = new Uint8Array(32)

/**
 * Compact-u16 (shortvec) encoder — Solana's custom varint.
 * 7 bits per byte, high bit = continuation.
 */
function encodeShortVec(value: number): Uint8Array {
  if (value < 0 || value > 0xffff) {
    throw new Error(`shortvec out of range: ${value}`)
  }
  const bytes: number[] = []
  let v = value
  while (true) {
    if ((v & ~0x7f) === 0) {
      bytes.push(v & 0x7f)
      break
    }
    bytes.push((v & 0x7f) | 0x80)
    v >>= 7
  }
  return new Uint8Array(bytes)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function encodeU64LE(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${value}`)
  }
  const out = new Uint8Array(8)
  let v = value
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function encodeU32LE(value: number): Uint8Array {
  const out = new Uint8Array(4)
  out[0] = value & 0xff
  out[1] = (value >>> 8) & 0xff
  out[2] = (value >>> 16) & 0xff
  out[3] = (value >>> 24) & 0xff
  return out
}

function decodeBase58Pubkey(b58: string, label: string): Uint8Array {
  const bytes = bs58.decode(b58)
  if (bytes.length !== 32) {
    throw new Error(`${label}: expected 32-byte pubkey, got ${bytes.length}`)
  }
  return bytes
}

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

function bytesToBase64(bytes: Uint8Array): string {
  // RN consumers install the `buffer` polyfill; `globalThis.Buffer` is set up
  // by the SDK's own RN shim. Use it for base64 encoding to stay consistent
  // with how other bridges return base64 (cosmos, sui).
  type BufferLike = {
    from: (input: Uint8Array) => { toString: (encoding: 'base64') => string }
  }
  const buf = (globalThis as unknown as { Buffer?: BufferLike }).Buffer
  if (buf?.from) {
    return buf.from(bytes).toString('base64')
  }
  // Node fallback (non-RN runs — unit tests). btoa + binary-string, safe for
  // byte arrays because every byte is an independent code point 0-255.
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  const b64encode = (globalThis as unknown as { btoa?: (s: string) => string })
    .btoa
  if (b64encode) return b64encode(binary)
  throw new Error('no base64 encoder available (install `buffer` polyfill)')
}

// ---------------------------------------------------------------------------
// Tx builder
// ---------------------------------------------------------------------------

/**
 * Build a native-SOL send transaction (legacy message, 1 Transfer instruction).
 *
 * @example
 * ```ts
 * const { blockhash } = await getSolanaRecentBlockhash(rpcUrl)
 * const tx = buildSolanaSendTx({
 *   from: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
 *   to:   '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
 *   lamports: 1_000n,
 *   recentBlockhash: blockhash,
 * })
 * const sigHex = await fastVaultSign(keyshare, tx.signingHashHex, ...)
 * const { rawTxBase64 } = tx.finalize(sigHex)
 * await broadcastSolanaTx(rawTxBase64, rpcUrl)
 * ```
 */
export function buildSolanaSendTx(
  opts: BuildSolanaSendOptions
): SolanaTxBuilderResult {
  const fromBytes = decodeBase58Pubkey(opts.from, 'from')
  const toBytes = decodeBase58Pubkey(opts.to, 'to')
  const blockhashBytes = decodeBase58Pubkey(opts.recentBlockhash, 'recentBlockhash')

  // Detect self-transfer: Solana messages dedupe account keys. If from == to,
  // we only list the key once (still signer + writable), and both instruction
  // account indexes point at 0.
  const selfTransfer =
    fromBytes.length === toBytes.length &&
    fromBytes.every((b, i) => b === toBytes[i])

  // Account ordering: writable-signer, then writable-nonsigner, then
  // readonly-nonsigner. Header counts derive from this ordering.
  //   - from       = writable signer
  //   - to         = writable nonsigner (if not self-transfer)
  //   - SystemProg = readonly nonsigner
  const accountKeys = selfTransfer
    ? [fromBytes, SYSTEM_PROGRAM_ID_BYTES]
    : [fromBytes, toBytes, SYSTEM_PROGRAM_ID_BYTES]

  const numRequiredSignatures = 1
  const numReadonlySigned = 0
  const numReadonlyUnsigned = 1 // SystemProgram

  // SystemProgram::Transfer instruction data:
  //   [u32 LE: instruction discriminator = 2][u64 LE: lamports]
  const instructionData = concatBytes(encodeU32LE(2), encodeU64LE(opts.lamports))

  const programIdIndex = selfTransfer ? 1 : 2
  const instructionAccounts = selfTransfer
    ? new Uint8Array([0, 0])
    : new Uint8Array([0, 1])

  const instruction = concatBytes(
    new Uint8Array([programIdIndex]),
    encodeShortVec(instructionAccounts.length),
    instructionAccounts,
    encodeShortVec(instructionData.length),
    instructionData
  )

  const message = concatBytes(
    new Uint8Array([numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned]),
    encodeShortVec(accountKeys.length),
    ...accountKeys,
    blockhashBytes,
    encodeShortVec(1), // 1 instruction
    instruction
  )

  const signingHashHex = bytesToHex(message)
  const unsignedRawHex = signingHashHex

  const finalize = (sigHex: string): { rawTxBase64: string; signature: string } => {
    const sigBytes = hexToBytes(sigHex)
    if (sigBytes.length !== 64) {
      throw new Error(
        `expected 64-byte ed25519 signature (128 hex chars), got ${sigBytes.length}`
      )
    }
    // Serialized transaction = [shortvec: numSigs][sig × numSigs][message]
    const txBytes = concatBytes(
      encodeShortVec(1),
      sigBytes,
      message
    )
    return {
      rawTxBase64: bytesToBase64(txBytes),
      signature: bs58.encode(sigBytes),
    }
  }

  return { signingHashHex, unsignedRawHex, finalize }
}
