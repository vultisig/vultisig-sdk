/**
 * RN-compatible vault backup encryption (PBKDF2 + AES-GCM), matching Node
 * `@vultisig/lib-utils/encryption/vaultBackup/encryptVaultBackupWithPassword`.
 */
import { gcm } from '@noble/ciphers/aes'
import { pbkdf2 } from '@noble/hashes/pbkdf2'
import { sha256 } from '@noble/hashes/sha2'
import { utf8ToBytes } from '@noble/hashes/utils'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_IV_LEN,
  VAULT_BACKUP_SALT_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'

export type EncryptVaultBackupWithPasswordOptions = {
  iterations?: number
  salt?: Buffer
  iv?: Buffer
}

export const encryptVaultBackupWithPassword = (
  password: string,
  plaintext: Buffer,
  options?: EncryptVaultBackupWithPasswordOptions
): Buffer => {
  const iterations = options?.iterations ?? DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS
  const salt =
    options?.salt ??
    (() => {
      const b = new Uint8Array(VAULT_BACKUP_SALT_LEN)
      globalThis.crypto.getRandomValues(b)
      return Buffer.from(b)
    })()
  if (salt.length !== VAULT_BACKUP_SALT_LEN) {
    throw new Error(`Vault backup salt must be ${VAULT_BACKUP_SALT_LEN} bytes`)
  }
  if (options?.iv !== undefined && options.iv.length !== VAULT_BACKUP_IV_LEN) {
    throw new Error(`Vault backup IV must be ${VAULT_BACKUP_IV_LEN} bytes`)
  }

  const key = pbkdf2(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: 32 })
  try {
    const nonce =
      options?.iv ??
      (() => {
        const n = new Uint8Array(VAULT_BACKUP_IV_LEN)
        globalThis.crypto.getRandomValues(n)
        return Buffer.from(n)
      })()
    const aes = gcm(key, new Uint8Array(nonce))
    const ciphertextWithTag = aes.encrypt(new Uint8Array(plaintext))
    return Buffer.concat([VAULT_BACKUP_BLOB_MAGIC, salt, nonce, Buffer.from(ciphertextWithTag)])
  } finally {
    key.fill(0)
  }
}
