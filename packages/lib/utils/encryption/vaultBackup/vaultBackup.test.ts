import { describe, expect, it } from 'vitest'

import { encryptWithAesGcm } from '../aesGcm/encryptWithAesGcm'
import { decryptVaultBackupWithPassword } from './decryptVaultBackupWithPassword'
import { encryptVaultBackupWithPassword } from './encryptVaultBackupWithPassword'
import {
  DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS,
  VAULT_BACKUP_BLOB_MAGIC,
  VAULT_BACKUP_IV_LEN,
  VAULT_BACKUP_MAGIC_LEN,
  VAULT_BACKUP_PBKDF2_HEADER_LEN,
  VAULT_BACKUP_SALT_LEN,
} from './vaultBackupConstants'

/** Only for layout tests — must not be passed to decrypt (decrypt always uses {@link DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS}). */
const layoutTestIterations = 10_000

describe('vault backup password crypto', () => {
  it(
    'round-trips PBKDF2 format (matches Android wire layout)',
    () => {
      const plaintext = Buffer.from('vault-protobuf-bytes')
      const password = 'correct horse battery staple'
      const blob = encryptVaultBackupWithPassword(password, plaintext)
      expect(blob.subarray(0, VAULT_BACKUP_MAGIC_LEN).equals(VAULT_BACKUP_BLOB_MAGIC)).toBe(true)
      expect(blob.length).toBeGreaterThanOrEqual(VAULT_BACKUP_PBKDF2_HEADER_LEN + 16)
      expect(decryptVaultBackupWithPassword(password, blob).equals(plaintext)).toBe(true)
    },
    120_000
  )

  it('decrypts legacy SHA-256(password) + GCM backups', () => {
    const plaintext = Buffer.from('legacy-inner-vault')
    const password = 'legacy-secret'
    const legacy = encryptWithAesGcm({ key: password, value: plaintext })
    expect(decryptVaultBackupWithPassword(password, legacy).equals(plaintext)).toBe(true)
  })

  it(
    'fails cleanly on wrong password (PBKDF2)',
    () => {
      const blob = encryptVaultBackupWithPassword('right', Buffer.from('data'))
      expect(() => decryptVaultBackupWithPassword('wrong', blob)).toThrow()
    },
    120_000
  )

  it('fails cleanly on wrong password (legacy)', () => {
    const legacy = encryptWithAesGcm({ key: 'right', value: Buffer.from('x') })
    expect(() => decryptVaultBackupWithPassword('wrong', legacy)).toThrow()
  })

  it(
    'throws on truncated PBKDF2 payload',
    () => {
      const blob = encryptVaultBackupWithPassword('pw', Buffer.from('data'))
      const truncated = blob.subarray(0, Math.min(blob.length, VAULT_BACKUP_PBKDF2_HEADER_LEN + 8))
      expect(() => decryptVaultBackupWithPassword('pw', truncated)).toThrow('truncated')
    },
    120_000
  )

  it('uses PBKDF2 iteration count matching Android / iOS (600k)', () => {
    expect(DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS).toBe(600_000)
  })

  /**
   * Locks PBKDF2 + AES-GCM bytes for fixed inputs (same layout as Android
   * `Pbkdf2AesEncryption` and iOS `Pbkdf2VaultBackupEncryption`).
   * If this fails after an intentional crypto change, recompute with Node and
   * confirm Android/iOS still match before updating the hex.
   */
  it(
    'golden vector (deterministic blob)',
    () => {
      const expectedHex =
        '564c5402030303030303030303030303030303030404040404040404040404041b0a21328e42d6527c5ba6f5817300bc2c6f'
      const blob = encryptVaultBackupWithPassword('golden-cross-platform', Buffer.from('xy'), {
        salt: Buffer.alloc(VAULT_BACKUP_SALT_LEN, 3),
        iv: Buffer.alloc(VAULT_BACKUP_IV_LEN, 4),
      })
      expect(blob.toString('hex')).toBe(expectedHex)
      expect(decryptVaultBackupWithPassword('golden-cross-platform', blob).toString()).toBe('xy')
    },
    120_000
  )

  it('encrypted output has stable header offsets (Android / iOS compatibility)', () => {
    const blob = encryptVaultBackupWithPassword('pw', Buffer.from('d'), {
      iterations: layoutTestIterations,
      salt: Buffer.alloc(VAULT_BACKUP_SALT_LEN, 1),
      iv: Buffer.alloc(VAULT_BACKUP_IV_LEN, 2),
    })
    expect(blob.readUInt32BE(0)).toBe(0x564c5402)
    expect(blob.subarray(4, 20).equals(Buffer.alloc(VAULT_BACKUP_SALT_LEN, 1))).toBe(true)
    expect(blob.subarray(20, 32).equals(Buffer.alloc(VAULT_BACKUP_IV_LEN, 2))).toBe(true)
  })
})
