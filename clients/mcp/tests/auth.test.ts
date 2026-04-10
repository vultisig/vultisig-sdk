import { afterEach, describe, expect, it } from 'vitest'

import { getDecryptionPassword, getServerPassword } from '../src/adapters/auth'

describe('shared auth adapter', () => {
  afterEach(() => {
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  it('returns VAULT_PASSWORD from env when keyring has no entry', async () => {
    process.env.VAULT_PASSWORD = 'test-password'
    const result = await getServerPassword('nonexistent-vault-id')
    expect(result).toBe('test-password')
  })

  it('returns null when no env var and no keyring entry', async () => {
    const result = await getServerPassword('nonexistent-vault-id')
    expect(result).toBeNull()
  })

  it('returns VAULT_DECRYPT_PASSWORD from env', async () => {
    process.env.VAULT_DECRYPT_PASSWORD = 'decrypt-pass'
    const result = await getDecryptionPassword('nonexistent-vault-id')
    expect(result).toBe('decrypt-pass')
  })

  it('returns null for decrypt password when not set', async () => {
    const result = await getDecryptionPassword('nonexistent-vault-id')
    expect(result).toBeNull()
  })
})
