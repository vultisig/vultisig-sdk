import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('keytar', () => {
  const store = new Map<string, string>()
  return {
    default: {
      getPassword: vi.fn((_service: string, account: string) => Promise.resolve(store.get(account) ?? null)),
      setPassword: vi.fn((_service: string, account: string, pw: string) => {
        store.set(account, pw)
        return Promise.resolve()
      }),
      deletePassword: vi.fn((_service: string, account: string) => {
        const had = store.has(account)
        store.delete(account)
        return Promise.resolve(had)
      }),
      _store: store,
    },
  }
})

import keytar from 'keytar'

import {
  clearCredentials,
  getDecryptionPassword,
  getServerPassword,
  SERVICE_NAME,
  setDecryptionPassword,
  setServerPassword,
} from '../../src/core/credential-store'

describe('credential-store', () => {
  const store = (keytar as any)._store as Map<string, string>

  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  afterEach(() => {
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  it('SERVICE_NAME is vultisig', () => {
    expect(SERVICE_NAME).toBe('vultisig')
  })

  it('setServerPassword stores and getServerPassword retrieves from keyring', async () => {
    await setServerPassword('vault-1', 'secret123')
    const pw = await getServerPassword('vault-1')
    expect(pw).toBe('secret123')
    expect(keytar.setPassword).toHaveBeenCalledWith('vultisig', 'vault-1/server', 'secret123')
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
