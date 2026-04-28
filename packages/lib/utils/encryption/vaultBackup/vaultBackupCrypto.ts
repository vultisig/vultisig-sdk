import crypto from 'crypto'

const GCM_TAG_LEN = 16

/**
 * AES-256-GCM encrypt; returns IV and sealed blob (ciphertext || auth tag).
 * Layout matches Android `PBKDF2_MAGIC + salt + iv + cipher.doFinal(plaintext)`.
 */
export const aes256GcmSeal = (
  cipherKey: Buffer,
  plaintext: Buffer,
  iv?: Buffer
): { iv: Buffer; sealed: Buffer } => {
  const nonce = iv ?? crypto.randomBytes(12)
  if (nonce.length !== 12) {
    throw new Error('AES-GCM IV must be 12 bytes')
  }
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey, nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  const sealed = Buffer.concat([ciphertext, authTag])
  return { iv: nonce, sealed }
}

export const aes256GcmOpen = (cipherKey: Buffer, iv: Buffer, sealed: Buffer): Buffer => {
  if (iv.length !== 12) {
    throw new Error('AES-GCM IV must be 12 bytes')
  }
  if (sealed.length < GCM_TAG_LEN) {
    throw new Error('Invalid sealed ciphertext')
  }
  const authTag = sealed.subarray(-GCM_TAG_LEN)
  const ciphertext = sealed.subarray(0, -GCM_TAG_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}
