import type { VaultBase, VaultStorage } from '@vultisig/sdk'
import { StorageError, StorageErrorCode, Vultisig } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadActiveVaultSafely } from '../active-vault'

/**
 * Regression: a corrupt/unreadable `~/.vultisig/activeVaultId.json` used to make
 * the storage read throw during CLI startup, which bricked EVERY command —
 * including `vultisig vaults`, the one you run to diagnose the problem. The
 * pointer read must now fail open so listing vaults still works with no active
 * vault marked.
 */
function makeSdk(overrides: Partial<Vultisig>): Vultisig {
  return overrides as unknown as Vultisig
}

const fakeVault = { id: 'vault-1', name: 'Main' } as unknown as VaultBase

describe('loadActiveVaultSafely', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the active vault and does not self-heal on a healthy pointer', async () => {
    const setActiveVault = vi.fn()
    const sdk = makeSdk({
      getActiveVault: vi.fn().mockResolvedValue(fakeVault),
      setActiveVault,
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toBe(fakeVault)
    expect(setActiveVault).not.toHaveBeenCalled()
  })

  it('passes through a null pointer (no active vault) without self-healing', async () => {
    const setActiveVault = vi.fn()
    const sdk = makeSdk({
      getActiveVault: vi.fn().mockResolvedValue(null),
      setActiveVault,
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toBeNull()
    expect(setActiveVault).not.toHaveBeenCalled()
  })

  it('fails open on a corrupt pointer: returns null, warns on stderr, self-heals', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const setActiveVault = vi.fn().mockResolvedValue(undefined)
    const sdk = makeSdk({
      getActiveVault: vi.fn().mockRejectedValue(new Error('Failed to read value for key "activeVaultId"')),
      setActiveVault,
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toBeNull()
    // self-heal clears the bad pointer
    expect(setActiveVault).toHaveBeenCalledWith(null)
    // warning goes to stderr (never stdout, so JSON output stays clean)
    expect(stderr).toHaveBeenCalledTimes(1)
    expect(stderr.mock.calls[0]?.[0]).toContain('active vault pointer is unreadable')
  })

  it('still returns null when self-heal itself fails', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const sdk = makeSdk({
      getActiveVault: vi.fn().mockRejectedValue(new Error('corrupt')),
      setActiveVault: vi.fn().mockRejectedValue(new Error('read-only fs')),
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toBeNull()
  })
})

/**
 * Wired through the real `Vultisig` SDK to prove the fix against the actual
 * `getActiveVault` / `setActiveVault` code paths — not just a mocked helper.
 * `ThrowingStorage` reproduces what the Node `FileStorage` does with a garbage
 * `activeVaultId.json`: the read of that one key throws a `StorageError`, while
 * every other key behaves normally.
 */
class ThrowingStorage implements VaultStorage {
  public readonly store = new Map<string, unknown>()
  public removed: string[] = []
  public corruptKey = 'activeVaultId'

  async get<T>(key: string): Promise<T | null> {
    if (key === this.corruptKey) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to read value for key "${key}"`)
    }
    return (this.store.get(key) as T) ?? null
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.store.set(key, value)
  }
  async remove(key: string): Promise<void> {
    this.removed.push(key)
    this.store.delete(key)
    if (key === this.corruptKey) this.corruptKey = '__none__'
  }
  async list(): Promise<string[]> {
    return [...this.store.keys()]
  }
  async clear(): Promise<void> {
    this.store.clear()
  }
}

describe('loadActiveVaultSafely (real Vultisig SDK)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fails open on a corrupt activeVaultId and self-heals via the SDK', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const storage = new ThrowingStorage()
    const sdk = new Vultisig({ storage })

    // Sanity: the raw SDK read still throws — that is the bug the helper absorbs.
    await expect(sdk.getActiveVault()).rejects.toBeInstanceOf(StorageError)

    await expect(loadActiveVaultSafely(sdk)).resolves.toBeNull()
    // self-heal removed the corrupt pointer through the real setActiveVault(null)
    expect(storage.removed).toContain('activeVaultId')
  })

  it('leaves a valid (non-corrupt) pointer untouched', async () => {
    const storage = new ThrowingStorage()
    storage.corruptKey = '__none__' // pointer reads cleanly now
    storage.store.set('activeVaultId', 'nonexistent-vault-id')
    const sdk = new Vultisig({ storage })

    // Dangling-but-valid pointer degrades to null without self-healing.
    await expect(loadActiveVaultSafely(sdk)).resolves.toBeNull()
    expect(storage.removed).not.toContain('activeVaultId')
  })
})
