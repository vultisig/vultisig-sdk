import { describe, expect, it } from 'vitest'

import { encryptWithAesGcm } from '../aesGcm/encryptWithAesGcm'
import { decryptVaultBackupWithPassword } from './decryptVaultBackupWithPassword'
import { encryptVaultBackupWithPassword } from './encryptVaultBackupWithPassword'
import { DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS, VAULT_BACKUP_BLOB_MAGIC } from './vaultBackupConstants'

const fastIterations = 10_000

describe('vault backup password crypto', () => {
  it('round-trips v2 (PBKDF2) format', () => {
    const plaintext = Buffer.from('vault-protobuf-bytes')
    const password = 'correct horse battery staple'
    const blob = encryptVaultBackupWithPassword(password, plaintext, { iterations: fastIterations })
    expect(blob.subarray(0, 8).equals(VAULT_BACKUP_BLOB_MAGIC)).toBe(true)
    expect(decryptVaultBackupWithPassword(password, blob).equals(plaintext)).toBe(true)
  })

  it('decrypts legacy SHA-256(password) + GCM backups', () => {
    const plaintext = Buffer.from('legacy-inner-vault')
    const password = 'legacy-secret'
    const legacy = encryptWithAesGcm({ key: password, value: plaintext })
    expect(decryptVaultBackupWithPassword(password, legacy).equals(plaintext)).toBe(true)
  })

  it('fails cleanly on wrong password (v2)', () => {
    const blob = encryptVaultBackupWithPassword('right', Buffer.from('data'), { iterations: fastIterations })
    expect(() => decryptVaultBackupWithPassword('wrong', blob)).toThrow()
  })

  it('fails cleanly on wrong password (legacy)', () => {
    const legacy = encryptWithAesGcm({ key: 'right', value: Buffer.from('x') })
    expect(() => decryptVaultBackupWithPassword('wrong', legacy)).toThrow()
  })

  it('defaults iteration count matches OWASP-style guidance', () => {
    expect(DEFAULT_VAULT_BACKUP_PBKDF2_ITERATIONS).toBe(600_000)
  })
})
