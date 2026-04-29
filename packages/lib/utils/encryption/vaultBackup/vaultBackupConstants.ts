/**
 * Password-protected vault backup blob (PBKDF2-HMAC-SHA256 + AES-256-GCM).
 *
 * Wire format matches vultisig-android `VaultBackupEncryption` / iOS PR #4197:
 * - Magic: 4 bytes — `VLT\\x02` (`0x56 0x4c 0x54 0x02`), distinguishable from legacy
 *   backups that start with a random 12-byte GCM nonce.
 * - Salt: 16 bytes — PBKDF2 salt (CSPRNG).
 * - IV: 12 bytes — AES-GCM nonce.
 * - Sealed: ciphertext + 16-byte auth tag (same as `Cipher.doFinal` output in Android).
 *
 * PBKDF2 is **not** parameterized on the wire: iteration count is always
 * {@link DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS} (600_000), algorithm PBKDF2-HMAC-SHA256,
 * derived key length 256 bits. Password encoding: UTF-8 (same as Node `pbkdf2Sync`
 * with a string password and Android `PBEKeySpec` over UTF-8-decoded password bytes).
 *
 * Binary blob is stored base64 inside `VaultContainer.vault` when `isEncrypted`.
 */
export const VAULT_BACKUP_BLOB_MAGIC = Buffer.from([0x56, 0x4c, 0x54, 0x02])

export const VAULT_BACKUP_MAGIC_LEN = 4

export const VAULT_BACKUP_SALT_LEN = 16

export const VAULT_BACKUP_IV_LEN = 12

/** Magic + salt + IV (before AES-GCM ciphertext + tag). */
export const VAULT_BACKUP_PBKDF2_HEADER_LEN =
  VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN + VAULT_BACKUP_IV_LEN

/** PBKDF2-HMAC-SHA256 iteration count for vault backups (OWASP / cross-platform agreement). */
export const DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS = 600_000
