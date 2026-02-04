import type { KeysignSignature } from '@core/mpc/keysign/KeysignSignature'

import type { Signature } from '../../types'

/**
 * Parse r and s values from DER-encoded signature
 *
 * DER format: 0x30 [total-length] 0x02 [r-length] [r] 0x02 [s-length] [s]
 *
 * @param derHex - DER-encoded signature in hex format
 * @returns Object containing r and s values as hex strings
 */
function parseDerSignature(derHex: string): { r: string; s: string } {
  // Remove 0x prefix if present
  const der = derHex.startsWith('0x') ? derHex.slice(2) : derHex

  let offset = 0

  // Skip 0x30 (SEQUENCE tag)
  offset += 2

  // Skip total length
  offset += 2

  // Skip 0x02 (INTEGER tag for r)
  offset += 2

  // Read r length
  const rLength = parseInt(der.slice(offset, offset + 2), 16) * 2
  offset += 2

  // Read r value
  let r = der.slice(offset, offset + rLength)
  // Remove leading 0x00 padding if present (added for DER encoding when high bit set)
  if (r.startsWith('00') && r.length > 64) {
    r = r.slice(2)
  }
  r = '0x' + r
  offset += rLength

  // Skip 0x02 (INTEGER tag for s)
  offset += 2

  // Read s length
  const sLength = parseInt(der.slice(offset, offset + 2), 16) * 2
  offset += 2

  // Read s value
  let s = der.slice(offset, offset + sLength)
  // Remove leading 0x00 padding if present
  if (s.startsWith('00') && s.length > 64) {
    s = s.slice(2)
  }
  s = '0x' + s

  return { r, s }
}

/**
 * Convert SDK Signature to core KeysignSignature format
 *
 * This function handles the conversion between SDK's simplified Signature type
 * and the core layer's KeysignSignature format expected by compileTx().
 *
 * @param signature - SDK signature from vault.sign()
 * @param messageHashes - Message hashes from extractMessageHashes()
 * @returns Map of message hash to KeysignSignature
 * @throws Error if signature format is invalid or message hashes are missing
 */
export function convertToKeysignSignatures(
  signature: Signature,
  messageHashes: string[]
): Record<string, KeysignSignature> {
  const result: Record<string, KeysignSignature> = {}

  if (signature.signatures && signature.signatures.length > 0) {
    // UTXO multi-signature case (multiple inputs)
    signature.signatures.forEach((sig, index) => {
      const messageHash = messageHashes[index]
      if (!messageHash) {
        throw new Error(`Missing message hash for signature at index ${index}`)
      }

      result[messageHash] = {
        msg: messageHash,
        r: sig.r,
        s: sig.s,
        der_signature: sig.der,
        recovery_id: signature.recovery?.toString(),
      }
    })
  } else {
    // Single signature case (most chains)
    const messageHash = messageHashes[0]
    if (!messageHash) {
      throw new Error('No message hash provided for signature')
    }

    let r: string, s: string

    if (signature.format === 'EdDSA') {
      // EdDSA: raw format r||s (each 32 bytes = 64 hex chars)
      // These values already have correct endianness from keysign
      const sig = signature.signature.startsWith('0x') ? signature.signature.slice(2) : signature.signature
      r = '0x' + sig.slice(0, 64)
      s = '0x' + sig.slice(64, 128)
    } else {
      // ECDSA: parse r and s from DER signature
      const parsed = parseDerSignature(signature.signature)
      r = parsed.r
      s = parsed.s
    }

    result[messageHash] = {
      msg: messageHash,
      r,
      s,
      der_signature: signature.signature,
      recovery_id: signature.recovery?.toString(),
    }
  }

  return result
}
