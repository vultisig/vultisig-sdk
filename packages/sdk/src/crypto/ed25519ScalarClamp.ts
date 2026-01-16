/**
 * Ed25519 scalar clamping utility for Schnorr key import
 *
 * This transformation is required when importing EdDSA private keys into
 * the Schnorr TSS protocol. It ensures the scalar is in the correct form
 * for Ed25519 operations.
 *
 * Copied from vultisig-windows: core/mpc/utils/ed25519ScalarClamp.ts
 */
import { sha512 } from '@noble/hashes/sha2'

/**
 * Ed25519 group order (L)
 * This is the order of the base point for Ed25519
 */
const ed25519GroupOrder = BigInt('0x1000000000000000000000000000000014DEF9DEA2F79CD65812631A5CF5D3ED')

/**
 * Apply Ed25519 scalar clamping
 * Clears the lowest 3 bits, clears the highest bit, and sets the second highest bit
 */
const clampScalar = (scalar: Uint8Array): Uint8Array => {
  const clamped = new Uint8Array(scalar)
  clamped[0] &= 0xf8 // Clear lowest 3 bits
  clamped[31] &= 0x3f // Clear highest 2 bits
  clamped[31] |= 0x40 // Set second highest bit
  return clamped
}

/**
 * Convert little-endian byte array to BigInt
 */
const littleEndianToBigInt = (bytes: Uint8Array): bigint => {
  let result = BigInt(0)
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << BigInt(8)) | BigInt(bytes[i])
  }
  return result
}

/**
 * Convert BigInt to little-endian byte array
 */
const bigIntToLittleEndian = (value: bigint, length: number): Uint8Array => {
  const result = new Uint8Array(length)
  let remaining = value
  for (let i = 0; i < length; i++) {
    result[i] = Number(remaining & BigInt(0xff))
    remaining >>= BigInt(8)
  }
  return result
}

/**
 * Reduce scalar modulo L (Ed25519 group order)
 */
const reduceModL = (scalar: Uint8Array): Uint8Array => {
  const value = littleEndianToBigInt(scalar)
  const reduced = value % ed25519GroupOrder
  return bigIntToLittleEndian(reduced, 32)
}

/**
 * Transform a 32-byte seed into a valid Ed25519 scalar for Schnorr key import
 *
 * This function:
 * 1. Hashes the seed with SHA-512
 * 2. Takes the first 32 bytes
 * 3. Applies Ed25519 scalar clamping
 * 4. Reduces modulo L (group order)
 *
 * This matches the iOS implementation in Data+KeyImport.swift (clampThenUniformScalar)
 *
 * @param seed - 32-byte seed (typically from HDWallet.getMasterKey for ed25519)
 * @returns 32-byte clamped and reduced scalar
 * @throws Error if seed is not 32 bytes
 */
export const clampThenUniformScalar = (seed: Uint8Array): Uint8Array => {
  if (seed.length !== 32) {
    throw new Error('Seed must be 32 bytes')
  }

  const hash = sha512(seed)
  const first32 = hash.slice(0, 32)
  const clamped = clampScalar(first32)
  return reduceModL(clamped)
}
