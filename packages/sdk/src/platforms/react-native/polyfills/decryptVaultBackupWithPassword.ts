/**
 * RN-compatible vault backup decryption with legacy fallback, matching Node
 * `@vultisig/lib-utils/encryption/vaultBackup/decryptVaultBackupWithPassword`.
 */
import { gcm } from '@noble/ciphers/aes'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'
import { utf8ToBytes } from '@noble/hashes/utils'
import {
  MAX_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_HEADER_LEN,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_SALT_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'

import { decryptWithAesGcm } from './decryptWithAesGcm'

const MIN_GCM_TAIL_LEN = 12 + 16

export const decryptVaultBackupWithPassword = (password: string, value: Buffer): Buffer => {
  if (
    value.length >= VAULT_BACKUP_MAGIC_LEN &&
    value.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)
  ) {
    if (value.length < VAULT_BACKUP_HEADER_LEN + MIN_GCM_TAIL_LEN) {
      throw new Error('Encrypted vault backup payload is truncated')
    }
    const salt = value.subarray(VAULT_BACKUP_MAGIC_LEN, VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN)
    const iterations = value.readUInt32BE(VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN)
    if (iterations < 1 || iterations > MAX_VAULT_BACKUP_PBKDF2_ITERATIONS) {
      throw new Error('Invalid vault backup iteration count')
    }
    const gcmBlob = value.subarray(VAULT_BACKUP_HEADER_LEN)
    const key = pbkdf2(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: 32 })
    const nonce = gcmBlob.subarray(0, 12)
    const ciphertextWithTag = gcmBlob.subarray(12)
    const aes = gcm(key, new Uint8Array(nonce))
    const plaintext = aes.decrypt(new Uint8Array(ciphertextWithTag))
    return Buffer.from(plaintext)
  }

  return decryptWithAesGcm({ key: password, value })
}
