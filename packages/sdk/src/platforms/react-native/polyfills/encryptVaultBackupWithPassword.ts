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
  VAULT_BACKUP_SALT_LEN,
} from '@vultisig/lib-utils/encryption/vaultBackup/vaultBackupConstants'

export type EncryptVaultBackupWithPasswordOptions = {
  iterations?: number
  salt?: Buffer
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
  const key = pbkdf2(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: 32 })
  const nonce = new Uint8Array(12)
  globalThis.crypto.getRandomValues(nonce)
  const aes = gcm(key, nonce)
  const ciphertext = aes.encrypt(new Uint8Array(plaintext))
  const iterBuf = Buffer.allocUnsafe(4)
  iterBuf.writeUInt32BE(iterations, 0)
  return Buffer.concat([VAULT_BACKUP_BLOB_MAGIC, salt, iterBuf, Buffer.from(nonce), Buffer.from(ciphertext)])
}
