import crypto from 'crypto'

/** AES-256-GCM: 12-byte nonce + ciphertext + 16-byte tag (same layout as encryptWithAesGcm). */
export const aes256GcmEncrypt = (cipherKey: Buffer, plaintext: Buffer): Buffer => {
  const nonce = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([nonce, ciphertext, authTag])
}

export const aes256GcmDecrypt = (cipherKey: Buffer, value: Buffer): Buffer => {
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, value.subarray(0, 12))
  const ciphertext = value.subarray(12, -16)
  const authTag = value.subarray(-16)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
