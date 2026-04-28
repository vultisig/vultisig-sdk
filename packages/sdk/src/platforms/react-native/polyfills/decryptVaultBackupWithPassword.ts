/**
 * RN-compatible vault backup decryption with legacy fallback, matching Node
 * `@vultisig/lib-utils/encryption/vaultBackup/decryptVaultBackupWithPassword`.
 */
import { gcm } from '@noble/ciphers/aes'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'
import { utf8ToBytes } from '@noble/hashes/utils'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_IV_LEN,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_PBKDF2_HEADER_LEN,
  VAULT_BACKUP_SALT_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'

import { decryptWithAesGcm } from './decryptWithAesGcm'

const GCM_TAG_LEN = 16

export const decryptVaultBackupWithPassword = (password: string, value: Buffer): Buffer => {
  if (
    value.length < VAULT_BACKUP_MAGIC_LEN ||
    !value.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)
  ) {
    return decryptWithAesGcm({ key: password, value })
  }

  if (value.length < VAULT_BACKUP_PBKDF2_HEADER_LEN + GCM_TAG_LEN) {
    throw new Error('Encrypted vault backup payload is truncated')
  }

  const salt = value.subarray(VAULT_BACKUP_MAGIC_LEN, VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN)
  const nonce = value.subarray(
    VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN,
    VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN + VAULT_BACKUP_IV_LEN
  )
  const sealed = value.subarray(VAULT_BACKUP_PBKDF2_HEADER_LEN)

  const key = pbkdf2(sha256, utf8ToBytes(password), salt, {
    c: DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
    dkLen: 32,
  })
  try {
    const aes = gcm(key, new Uint8Array(nonce))
    const plaintext = aes.decrypt(new Uint8Array(sealed))
    return Buffer.from(plaintext)
  } finally {
    key.fill(0)
  }
}
