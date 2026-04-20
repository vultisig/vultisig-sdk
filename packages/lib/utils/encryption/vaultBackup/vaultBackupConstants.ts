/**
 * Password-protected vault backup blob (v2): PBKDF2-HMAC-SHA256 + AES-256-GCM.
 *
 * Wire format (binary, stored base64 inside VaultContainer.vault when isEncrypted):
 * - Magic: 8 bytes ASCII `VULTIBK1` — versioned prefix so decrypt can branch before legacy
 *   SHA-256(password) + GCM path (which begins with a random 12-byte nonce).
 * - Salt: 16 bytes — PBKDF2 salt (CSPRNG).
 * - Iterations: 4 bytes big-endian uint32 — PBKDF2-HMAC-SHA256 iteration count.
 * - GCM segment: 12-byte nonce + ciphertext + 16-byte auth tag (AES-256-GCM, DK = PBKDF2 output).
 *
 * Password: UTF-8 string (matches Node crypto.pbkdf2Sync default for string passwords).
 *
 * Port this layout byte-for-byte on Android/iOS when adding the same issue.
 */
export const VAULT_BACKUP_BLOB_MAGIC = Buffer.from('VULTIBK1', 'ascii')

export const VAULT_BACKUP_MAGIC_LEN = 8

export const VAULT_BACKUP_SALT_LEN = 16

export const VAULT_BACKUP_ITER_BYTES = 4

export const VAULT_BACKUP_HEADER_LEN =
  VAULT_BACKUP_MAGIC_LEN + VAULT_BACKUP_SALT_LEN + VAULT_BACKUP_ITER_BYTES

/** PBKDF2-HMAC-SHA256 iteration count for new backups (OWASP / issue guidance). */
export const DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS = 600_000

/** Upper bound for iteration count read from untrusted blobs (DoS mitigation). */
export const MAX_VAULT_BACKUP_PBKDF2_ITERATIONS = 10_000_000
