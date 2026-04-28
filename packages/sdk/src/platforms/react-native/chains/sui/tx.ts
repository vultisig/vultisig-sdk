/**
 * Sui transaction signing primitives (RN-safe).
 *
 * Vendored from vultiagent-app/src/services/suiTx.ts. The orchestration
 * (fetching coins, broadcasting via JSON-RPC) stays with the consumer
 * because it requires the RPC URL injection. This module provides the
 * pure cryptographic primitives:
 *
 *   - `deriveSuiAddress(eddsaPubKeyHex)` — address from EdDSA pubkey via
 *     blake2b (no @mysten/sui SDK — that crashes on Hermes).
 *   - `buildSuiSigningHash(txBytes)` — the intent-wrapped blake2b-256 hash
 *     that must be signed.
 *   - `buildSuiSerializedSignature(signature, pubkey)` — assembles the
 *     97-byte Sui sig format (flag || sig || pubkey).
 */

import { blake2b } from '@noble/hashes/blake2.js'

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

/**
 * Sui address derivation: blake2b-256(0x00 || eddsa_pubkey).
 * Returns `0x`-prefixed hex.
 */
export function deriveSuiAddress(eddsaPubKeyHex: string): string {
  const pubKeyBytes = hexToBytes(eddsaPubKeyHex)
  if (pubKeyBytes.length !== 32) {
    throw new Error(`deriveSuiAddress: EdDSA pubkey must be 32 bytes, got ${pubKeyBytes.length}`)
  }
  const data = new Uint8Array(33)
  data[0] = 0x00
  data.set(pubKeyBytes, 1)
  const hash = blake2b(data, { dkLen: 32 })
  return '0x' + bytesToHex(hash)
}

/**
 * Produce the Sui intent-prefixed blake2b-256 hash consumers must sign.
 * Intent prefix is `[0, 0, 0]` (TransactionData, V0, Sui).
 *
 * @returns { hashBytes, hashHex } — hashHex is ready to pass to schnorrSign.
 */
export function buildSuiSigningHash(txBytes: Uint8Array): {
  hashBytes: Uint8Array
  hashHex: string
} {
  const intentMessage = new Uint8Array(3 + txBytes.length)
  intentMessage[0] = 0
  intentMessage[1] = 0
  intentMessage[2] = 0
  intentMessage.set(txBytes, 3)
  const hashBytes = blake2b(intentMessage, { dkLen: 32 })
  return { hashBytes, hashHex: bytesToHex(hashBytes) }
}

/**
 * Assemble the 97-byte Sui serialized signature:
 *   flag(1 byte, 0x00 for Ed25519) || signature(64 bytes) || pubkey(32 bytes).
 * Signature input: raw R||S bytes (64) returned by schnorrSign.
 */
export function buildSuiSerializedSignature(signature: Uint8Array, eddsaPubKeyHex: string): Uint8Array {
  if (signature.length !== 64) {
    throw new Error(`Sui signature must be 64 bytes (R||S), got ${signature.length}`)
  }
  const pubKeyBytes = hexToBytes(eddsaPubKeyHex)
  if (pubKeyBytes.length !== 32) {
    throw new Error(`Sui EdDSA pubkey must be 32 bytes, got ${pubKeyBytes.length}`)
  }
  const suiSig = new Uint8Array(97)
  suiSig[0] = 0x00
  suiSig.set(signature, 1)
  suiSig.set(pubKeyBytes, 65)
  return suiSig
}
