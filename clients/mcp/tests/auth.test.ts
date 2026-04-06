import { afterEach, describe, expect, it, vi } from 'vitest'

import { EnvVarAdapter, FallbackAuthAdapter } from '../src/adapters/auth'

describe('EnvVarAdapter', () => {
  afterEach(() => {
    delete process.env.VAULT_PASSWORD
    delete process.env.VAULT_DECRYPT_PASSWORD
  })

  it('returns VAULT_PASSWORD from env', async () => {
    process.env.VAULT_PASSWORD = 'test-password'
    const adapter = new EnvVarAdapter()
    expect(await adapter.getPassword('any-vault')).toBe('test-password')
  })

  it('returns null when VAULT_PASSWORD not set', async () => {
    const adapter = new EnvVarAdapter()
    expect(await adapter.getPassword('any-vault')).toBeNull()
  })

  it('returns VAULT_DECRYPT_PASSWORD from env', async () => {
    process.env.VAULT_DECRYPT_PASSWORD = 'decrypt-pass'
    const adapter = new EnvVarAdapter()
    expect(await adapter.getDecryptionPassword('any-vault')).toBe('decrypt-pass')
  })

  it('returns null when VAULT_DECRYPT_PASSWORD not set', async () => {
    const adapter = new EnvVarAdapter()
    expect(await adapter.getDecryptionPassword('any-vault')).toBeNull()
  })
})

describe('FallbackAuthAdapter', () => {
  it('returns first non-null result', async () => {
    const first = {
      getPassword: vi.fn().mockResolvedValue(null),
      getDecryptionPassword: vi.fn().mockResolvedValue(null),
    }
    const second = {
      getPassword: vi.fn().mockResolvedValue('from-second'),
      getDecryptionPassword: vi.fn().mockResolvedValue('decrypt-second'),
    }
    const adapter = new FallbackAuthAdapter([first, second])
    expect(await adapter.getPassword('v1')).toBe('from-second')
    expect(await adapter.getDecryptionPassword('v1')).toBe('decrypt-second')
  })

  it('returns first adapter result when available', async () => {
    const first = {
      getPassword: vi.fn().mockResolvedValue('from-first'),
      getDecryptionPassword: vi.fn().mockResolvedValue('decrypt-first'),
    }
    const second = {
      getPassword: vi.fn().mockResolvedValue('from-second'),
      getDecryptionPassword: vi.fn().mockResolvedValue('decrypt-second'),
    }
    const adapter = new FallbackAuthAdapter([first, second])
    expect(await adapter.getPassword('v1')).toBe('from-first')
    expect(second.getPassword).not.toHaveBeenCalled()
  })

  it('returns null when all adapters return null', async () => {
    const first = {
      getPassword: vi.fn().mockResolvedValue(null),
      getDecryptionPassword: vi.fn().mockResolvedValue(null),
    }
    const adapter = new FallbackAuthAdapter([first])
    expect(await adapter.getPassword('v1')).toBeNull()
  })
})
