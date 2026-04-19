/**
 * Extract the transaction body bytes from a full Cardano transaction CBOR
 * and compute its blake2b-256 hash — the "transaction id".
 *
 * The body bytes are extracted verbatim (not re-encoded) because
 * re-encoding via cbor-x could change key ordering or integer widths,
 * producing a different hash than the one the dApp expects.
 */
import { blake2b } from '@noble/hashes/blake2b'
import { decode } from 'cbor-x'

import { cborSkip } from './cborSkip'

/**
 * Given the hex-encoded CBOR of a full Cardano transaction, return
 * the blake2b-256 hash of the transaction body (the first array element).
 */
export const cardanoTxBodyHash = (txCborHex: string): Uint8Array => {
  const txBytes = Uint8Array.from(Buffer.from(txCborHex, 'hex'))
  const bodyBytes = extractTxBodyBytes(txBytes)
  return blake2b(bodyBytes, { dkLen: 32 })
}

/**
 * Verify the CBOR is a 4-element array `[body, witnesses, isValid, aux]`
 * and return the raw bytes of the body element without re-encoding.
 */
const extractTxBodyBytes = (txCbor: Uint8Array): Uint8Array => {
  // Validate structure: must be a 4-element array
  const decoded = decode(txCbor)
  if (!Array.isArray(decoded) || decoded.length < 2) {
    throw new Error('Invalid Cardano transaction CBOR: expected array of length >= 2')
  }

  // Walk the raw bytes to find the body element's byte range.
  // Byte 0 is the array header (0x84 for definite 4-item array).
  const arrayHeaderEnd = cborSkipHead(txCbor, 0)
  const bodyEnd = cborSkip(txCbor, arrayHeaderEnd)

  return txCbor.slice(arrayHeaderEnd, bodyEnd)
}

/**
 * Skip just the CBOR head (major type + argument) at `offset`.
 * Returns the offset after the head (i.e., where the content starts).
 */
const cborSkipHead = (data: Uint8Array, offset: number): number => {
  const additional = data[offset] & 0x1f
  if (additional < 24) return offset + 1
  if (additional === 24) return offset + 2
  if (additional === 25) return offset + 3
  if (additional === 26) return offset + 5
  if (additional === 27) return offset + 9
  throw new Error(`Unsupported CBOR additional info ${additional} at offset ${offset}`)
}
