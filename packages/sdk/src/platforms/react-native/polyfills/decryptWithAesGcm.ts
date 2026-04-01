/**
 * RN-compatible replacement for @lib/utils/encryption/aesGcm/decryptWithAesGcm
 * Uses @noble/ciphers instead of Node.js crypto
 */
import { gcm } from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha2'

import { AesGcmInput } from '../../../../lib/utils/encryption/aesGcm/AesGcmInput'

export const decryptWithAesGcm = ({ key, value }: AesGcmInput): Buffer => {
  const keyBytes = typeof key === 'string' ? Buffer.from(key) : key
  const cipherKey = sha256(new Uint8Array(keyBytes))
  const nonce = value.subarray(0, 12)
  const ciphertextWithTag = value.subarray(12)
  const aes = gcm(cipherKey, new Uint8Array(nonce))
  const plaintext = aes.decrypt(new Uint8Array(ciphertextWithTag))
  return Buffer.from(plaintext)
}
