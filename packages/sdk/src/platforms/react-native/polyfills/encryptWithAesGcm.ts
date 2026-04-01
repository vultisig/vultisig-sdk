/**
 * RN-compatible replacement for @lib/utils/encryption/aesGcm/encryptWithAesGcm
 * Uses @noble/ciphers instead of Node.js crypto
 */
import { gcm } from '@noble/ciphers/aes'
import { sha256 } from '@noble/hashes/sha2'
import { AesGcmInput } from '@vultisig/lib-utils/encryption/aesGcm/AesGcmInput'

export const encryptWithAesGcm = ({ key, value }: AesGcmInput): Buffer => {
  const keyBytes = typeof key === 'string' ? Buffer.from(key) : key
  const cipherKey = sha256(new Uint8Array(keyBytes))
  const nonce = new Uint8Array(12)
  globalThis.crypto.getRandomValues(nonce)
  const aes = gcm(cipherKey, nonce)
  const ciphertext = aes.encrypt(new Uint8Array(value))
  return Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)])
}
