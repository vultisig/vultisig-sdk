import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStore } = vi.hoisted(() => {
  const mockStore = new Map<string, string>()
  return { mockStore }
})

vi.mock('@napi-rs/keyring', () => ({
  Entry: class MockEntry {
    private key: string
    constructor(service: string, account: string) {
      this.key = `${service}/${account}`
    }
    getPassword(): string {
      const val = mockStore.get(this.key)
      if (val === undefined) throw new Error('not found')
      return val
    }
    setPassword(pw: string): void {
      mockStore.set(this.key, pw)
    }
    deletePassword(): void {
      mockStore.delete(this.key)
    }
  },
}))

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockRejectedValue(new Error('not found')),
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

import {
  _resetAll,
  clearCredentials,
  getDecryptionPassword,
  getServerPassword,
  setDecryptionPassword,
  setServerPassword,
} from '../../src/core/credential-store'

describe('credential-store', () => {
  beforeEach(() => {
    _resetAll()
    mockStore.clear()
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  afterEach(() => {
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  it('setServerPassword stores and getServerPassword retrieves from keyring', async () => {
    await setServerPassword('vault-1', 'secret123')
    const pw = await getServerPassword('vault-1')
    expect(pw).toBe('secret123')
  })

  it('setDecryptionPassword stores and getDecryptionPassword retrieves from keyring', async () => {
    await setDecryptionPassword('vault-1', 'decrypt456')
    const pw = await getDecryptionPassword('vault-1')
    expect(pw).toBe('decrypt456')
  })

  it('getServerPassword falls back to VAULT_PASSWORD env var', async () => {
    process.env.VAULT_PASSWORD = 'env-pw'
    const pw = await getServerPassword('vault-1')
    expect(pw).toBe('env-pw')
  })

  it('getDecryptionPassword falls back to VAULT_DECRYPT_PASSWORD env var', async () => {
    process.env.VAULT_DECRYPT_PASSWORD = 'env-decrypt'
    const pw = await getDecryptionPassword('vault-1')
    expect(pw).toBe('env-decrypt')
  })

  it('keyring takes priority over env vars', async () => {
    await setServerPassword('vault-1', 'keyring-pw')
    process.env.VAULT_PASSWORD = 'env-pw'
    const pw = await getServerPassword('vault-1')
    expect(pw).toBe('keyring-pw')
  })

  it('returns null when no keyring entry and no env var', async () => {
    const pw = await getServerPassword('vault-1')
    expect(pw).toBeNull()
  })

  it('clearCredentials removes both server and decrypt entries', async () => {
    await setServerPassword('vault-1', 'pw1')
    await setDecryptionPassword('vault-1', 'pw2')
    await clearCredentials('vault-1')
    const server = await getServerPassword('vault-1')
    const decrypt = await getDecryptionPassword('vault-1')
    expect(server).toBeNull()
    expect(decrypt).toBeNull()
  })
})
