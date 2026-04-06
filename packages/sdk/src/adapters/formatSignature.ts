import type { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import type { KeysignSignature } from '@vultisig/core-mpc/keysign/KeysignSignature'

import type { Signature } from '../types'

/**
 * Strip 0x or 0X prefix from a hex string if present
 */
function stripHexPrefix(value: string): string {
  return value.startsWith('0x') || value.startsWith('0X') ? value.slice(2) : value
}

/**
 * Format core keysign signature(s) into SDK Signature type
 *
 * Handles both single-signature (EVM, Cosmos, etc.) and multi-signature (UTXO) cases.
 * This adapter encapsulates chain-specific signature formatting logic.
 *
 * @param signatureResults - Map of message hashes to KeysignSignatures from core keysign
 * @param messages - Original message hashes that were signed (in order)
 * @param signatureAlgorithm - ECDSA or EdDSA from keysign (not `mldsa`; use {@link formatMldsaSignature} for ML-DSA-only results)
 * @returns SDK Signature format with optional multi-signature support
 */
export function formatMldsaSignature(mldsaHex: string): Signature {
  const signature = stripHexPrefix(mldsaHex)
  return {
    signature,
    format: 'MLDSA',
    mldsaSignature: signature,
  }
}

export function formatSignature(
  signatureResults: Record<string, KeysignSignature>,
  messages: string[],
  signatureAlgorithm: SignatureAlgorithm
): Signature {
  if (signatureAlgorithm === 'mldsa') {
    throw new Error('formatSignature does not support mldsa; use formatMldsaSignature() with the ML-DSA signing result')
  }

  const firstMessage = messages[0]
  const firstSignature = signatureResults[firstMessage]

  if (!firstSignature) {
    throw new Error('No signature result found for first message')
  }

  // Map signature algorithm to SDK signature format
  const signatureFormat = mapAlgorithmToFormat(signatureAlgorithm)

  // Base signature (always present)
  const signature: Signature = {
    // For EdDSA, store raw r||s (already has correct endianness from keysign)
    // Strip any 0x prefixes to ensure clean concatenation
    // For ECDSA, store der_signature
    signature:
      signatureAlgorithm === 'eddsa'
        ? stripHexPrefix(firstSignature.r) + stripHexPrefix(firstSignature.s)
        : firstSignature.der_signature,
    recovery: firstSignature.recovery_id ? parseInt(firstSignature.recovery_id) : undefined,
    format: signatureFormat,
  }

  // For UTXO chains with multiple inputs, include all signatures
  if (messages.length > 1) {
    signature.signatures = messages.map(msg => ({
      r: signatureResults[msg].r,
      s: signatureResults[msg].s,
      der: signatureResults[msg].der_signature,
    }))
  }

  return signature
}

/**
 * Map core signature algorithm to SDK signature format
 *
 * @param algorithm - Core signature algorithm (ecdsa or eddsa)
 * @returns SDK signature format
 */
function mapAlgorithmToFormat(algorithm: SignatureAlgorithm): Signature['format'] {
  switch (algorithm) {
    case 'ecdsa':
      return 'ECDSA'
    case 'eddsa':
      return 'EdDSA'
    default:
      throw new Error(`Unknown signature algorithm: ${algorithm}`)
  }
}
