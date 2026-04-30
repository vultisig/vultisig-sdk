import { Buffer } from 'buffer'
import crypto from 'crypto'

import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_IV_LEN,
  VAULT_BACKUP_SALT_LEN,
} from './vaultBackupConstants'
import { aes256GcmSeal } from './vaultBackupCrypto'

export type EncryptVaultBackupWithPasswordOptions = {
  /**
   * PBKDF2-HMAC-SHA256 iterations (never stored on the wire).
   * Defaults to {@link DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS}.
   * Cross-platform backups must omit this so encrypt matches Android/iOS (600k).
   * Lower values are only for layout-only tests that never call `decryptVaultBackupWithPassword`.
   */
  iterations?: number
  /** Fixed salt (16 bytes) for deterministic tests. Random when omitted. */
  salt?: Buffer
  /** Fixed IV (12 bytes) for deterministic tests. Random when omitted. */
  iv?: Buffer
}

/**
 * Encrypt vault backup bytes with a user password (PBKDF2 + AES-GCM).
 * Wire format matches Android / iOS; does not use legacy SHA-256(password) KDF.
 */
export const encryptVaultBackupWithPassword = (
  password: string,
  plaintext: Buffer,
  options?: EncryptVaultBackupWithPasswordOptions
): Buffer => {
  const iterations = options?.iterations ?? DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS
  const salt = options?.salt ?? crypto.randomBytes(VAULT_BACKUP_SALT_LEN)
  if (salt.length !== VAULT_BACKUP_SALT_LEN) {
    throw new Error(`Vault backup salt must be ${VAULT_BACKUP_SALT_LEN} bytes`)
  }
  if (options?.iv !== undefined && options.iv.length !== VAULT_BACKUP_IV_LEN) {
    throw new Error(`Vault backup IV must be ${VAULT_BACKUP_IV_LEN} bytes`)
  }

  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  try {
    const { iv, sealed } = aes256GcmSeal(key, plaintext, options?.iv)
    return Buffer.concat([VAULT_BACKUP_BLOB_MAGIC, salt, iv, sealed])
  } finally {
    key.fill(0)
  }
}
