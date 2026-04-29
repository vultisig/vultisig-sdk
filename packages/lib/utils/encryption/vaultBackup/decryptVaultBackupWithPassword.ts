import crypto from 'crypto'

import { decryptWithAesGcm } from '../aesGcm/decryptWithAesGcm'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_IV_LEN,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_PBKDF2_HEADER_LEN,
  VAULT_BACKUP_SALT_LEN,
} from './vaultBackupConstants'
import { aes256GcmOpen } from './vaultBackupCrypto'

const GCM_TAG_LEN = 16

function isPbkdf2VaultBackupMagic(value: Buffer): boolean {
  return (
    value.length >= VAULT_BACKUP_MAGIC_LEN &&
    value.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)
  )
}

/**
 * Decrypt password-protected vault backup bytes.
 * If the payload starts with the PBKDF2 magic (`VLT\\x02`), uses PBKDF2 + AES-GCM only
 * (fail closed — no legacy fallback when the marker matches).
 * Otherwise uses legacy SHA-256(password) + AES-GCM.
 */
export const decryptVaultBackupWithPassword = (password: string, value: Buffer): Buffer => {
  if (!isPbkdf2VaultBackupMagic(value)) {
    return decryptWithAesGcm({ key: password, value })
  }

  if (value.length < VAULT_BACKUP_PBKDF2_HEADER_LEN + GCM_TAG_LEN) {
    throw new Error('Encrypted vault backup payload is truncated')
  }

  const salt = value.subarray(VAULT_BACKUP_MAGIC_LEN, VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN)
  const iv = value.subarray(
    VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN,
    VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN + VAULT_BACKUP_IV_LEN
  )
  const sealed = value.subarray(VAULT_BACKUP_PBKDF2_HEADER_LEN)

  const key = crypto.pbkdf2Sync(password, salt, DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS, 32, 'sha256')
  try {
    return aes256GcmOpen(key, iv, sealed)
  } finally {
    key.fill(0)
  }
}
