/**
 * Cryptographic utilities module
 * Stub implementations for compilation - actual implementations come from lib/utils at runtime
 */

// AES-GCM encryption/decryption - will be loaded dynamically at runtime
export const encryptWithAesGcm = async (params: { value: any, key: any }): Promise<any> => {
  const { encryptWithAesGcm } = await import('@lib/utils/encryption/aesGcm/encryptWithAesGcm')
  return encryptWithAesGcm(params)
}

export const decryptWithAesGcm = async (params: { value: any, key: any }): Promise<any> => {
  const { decryptWithAesGcm } = await import('@lib/utils/encryption/aesGcm/decryptWithAesGcm')
  return decryptWithAesGcm(params)
}

// Base64 utilities
export const base64Encode = (data: any): string => {
  // Dynamic import at runtime
  return typeof btoa !== 'undefined' ? btoa(data) : Buffer.from(data).toString('base64')
}

export const fromBase64 = (data: string): any => {
  // Dynamic import at runtime  
  return typeof atob !== 'undefined' ? atob(data) : Buffer.from(data, 'base64').toString()
}

// Hex utilities - simple implementations
export const ensureHexPrefix = (hex: string): string => hex.startsWith('0x') ? hex : `0x${hex}`
export const stripHexPrefix = (hex: string): string => hex.startsWith('0x') ? hex.slice(2) : hex
export const hexToNumber = (hex: string): number => parseInt(stripHexPrefix(hex), 16)
export const numberToHex = (num: number): string => num.toString(16)

// Random bytes
export const getHexEncodedRandomBytes = (length: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

// BigInt utilities - simple implementations
export const bigIntMax = (...values: bigint[]): bigint => values.reduce((max, val) => val > max ? val : max)
export const bigIntSum = (values: bigint[]): bigint => values.reduce((sum, val) => sum + val, 0n)
export const bigIntToHex = (value: bigint): string => `0x${value.toString(16)}`