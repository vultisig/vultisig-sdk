import crypto from 'crypto'

import { decryptWithAesGcm } from '../aesGcm/decryptWithAesGcm'
import {
  MAX_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_HEADER_LEN,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_SALT_LEN,
} from './vaultBackupConstants'
import { aes256GcmDecrypt } from './vaultBackupCrypto'

const MIN_GCM_TAIL_LEN = 12 + 16

/**
 * Decrypt password-protected vault backup bytes.
 * Tries v2 (PBKDF2 + magic prefix) first, then legacy SHA-256(password) + AES-GCM.
 */
export const decryptVaultBackupWithPassword = (password: string, value: Buffer): Buffer => {
  if (
    value.length >= VAULT_BACKUP_MAGIC_LEN &&
    value.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)
  ) {
    if (value.length < VAULT_BACKUP_HEADER_LEN + MIN_GCM_TAIL_LEN) {
      throw new Error('Encrypted vault backup payload is truncated')
    }
    const salt = value.subarray(
      VAULT_BACKUP_MAGIC_LEN,
      VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN
    )
    const iterations = value.readUInt32BE(VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN)
    if (iterations < 1 || iterations > MAX_VAULT_BACKUP_PBKDF2_ITERATIONS) {
      throw new Error('Invalid vault backup iteration count')
    }
    const gcmBlob = value.subarray(VAULT_BACKUP_HEADER_LEN)
    const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
    return aes256GcmDecrypt(key, gcmBlob)
  }

  return decryptWithAesGcm({ key: password, value })
}
