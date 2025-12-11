import type { BytesInput } from '../types'

/**
 * Normalize byte input to hex string format
 *
 * @param input - Uint8Array, Buffer, or hex string
 * @returns Hex string without 0x prefix
 * @throws Error if input format is invalid
 */
export function normalizeToHex(input: BytesInput): string {
  if (typeof input === 'string') {
    // Remove 0x prefix if present
    const hex = input.startsWith('0x') ? input.slice(2) : input

    // Validate hex string
    if (!/^[0-9a-fA-F]*$/.test(hex)) {
      throw new Error('Invalid hex string: contains non-hex characters')
    }

    if (hex.length === 0) {
      throw new Error('Invalid input: empty data')
    }

    return hex.toLowerCase()
  }

  // Handle Uint8Array and Buffer
  if (input.length === 0) {
    throw new Error('Invalid input: empty data')
  }

  return Buffer.from(input).toString('hex')
}
