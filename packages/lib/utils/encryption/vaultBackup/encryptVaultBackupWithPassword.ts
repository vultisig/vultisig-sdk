import crypto from 'crypto'

import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_HEADER_LEN,
  VAULT_BACKUP_SALT_LEN,
} from './vaultBackupConstants'
import { aes256GcmEncrypt } from './vaultBackupCrypto'

export type EncryptVaultBackupWithPasswordOptions = {
  /**
   * PBKDF2-HMAC-SHA256 iterations. Defaults to {@link DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS}.
   * Lower values are only for unit tests.
   */
  iterations?: number
  /** Fixed salt (16 bytes) for deterministic tests. Random when omitted. */
  salt?: Buffer
}

/**
 * Encrypt vault backup bytes with a user password (v2: PBKDF2 + AES-GCM).
 * Does not use legacy SHA-256(password) key derivation.
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
  const key = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256')
  const gcmBlob = aes256GcmEncrypt(key, plaintext)
  const iterBuf = Buffer.allocUnsafe(4)
  iterBuf.writeUInt32BE(iterations, 0)
  return Buffer.concat([VAULT_BACKUP_BLOB_MAGIC, salt, iterBuf, gcmBlob])
}
