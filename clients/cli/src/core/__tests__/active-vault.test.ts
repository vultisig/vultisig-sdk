import type { VaultBase, VaultStorage } from '@vultisig/sdk'
import { StorageError, StorageErrorCode, Vultisig } from '@vultisig/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadActiveVaultSafely, shouldAutoSelectActiveVault } from '../active-vault'

/**
 * Regression: a corrupt/unreadable `~/.vultisig/activeVaultId.json` used to make
 * the storage read throw during CLI startup, which bricked EVERY command —
 * including `vultisig vaults`, the one you run to diagnose the problem. The
 * pointer read must now fail open so listing vaults still works with no active
 * vault marked, while a valid pointer still resolves its vault and an error
 * loading that vault's data still surfaces.
 */
const fakeVault = { id: 'vault-1', name: 'Main' } as unknown as VaultBase

type SdkStubs = {
  get?: ReturnType<typeof vi.fn>
  getVaultById?: ReturnType<typeof vi.fn>
  setActiveVault?: ReturnType<typeof vi.fn>
}

function makeSdk({ get, getVaultById, setActiveVault }: SdkStubs): Vultisig {
  return {
    storage: { get: get ?? vi.fn().mockResolvedValue(null) },
    getVaultById: getVaultById ?? vi.fn().mockResolvedValue(null),
    setActiveVault: setActiveVault ?? vi.fn().mockResolvedValue(undefined),
  } as unknown as Vultisig
}

describe('loadActiveVaultSafely', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves the vault the pointer names and does not self-heal on a healthy pointer', async () => {
    const setActiveVault = vi.fn()
    const getVaultById = vi.fn().mockResolvedValue(fakeVault)
    const sdk = makeSdk({ get: vi.fn().mockResolvedValue('vault-1'), getVaultById, setActiveVault })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: fakeVault, corruptPointer: false })
    expect(getVaultById).toHaveBeenCalledWith('vault-1')
    expect(setActiveVault).not.toHaveBeenCalled()
  })

  it('passes through a null pointer (no active vault) without loading or self-healing', async () => {
    const setActiveVault = vi.fn()
    const getVaultById = vi.fn()
    const sdk = makeSdk({ get: vi.fn().mockResolvedValue(null), getVaultById, setActiveVault })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: false })
    expect(getVaultById).not.toHaveBeenCalled()
    expect(setActiveVault).not.toHaveBeenCalled()
  })

  it('fails open on a corrupt pointer: returns corruptPointer, warns on stderr only, self-heals', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const setActiveVault = vi.fn().mockResolvedValue(undefined)
    const getVaultById = vi.fn()
    const sdk = makeSdk({
      get: vi.fn().mockRejectedValue(new Error('Failed to read value for key "activeVaultId"')),
      getVaultById,
      setActiveVault,
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: true })
    // we never tried to resolve a vault from an unreadable pointer
    expect(getVaultById).not.toHaveBeenCalled()
    // self-heal clears the bad pointer
    expect(setActiveVault).toHaveBeenCalledWith(null)
    // warning goes to stderr...
    expect(stderr).toHaveBeenCalledTimes(1)
    expect(stderr.mock.calls[0]?.[0]).toContain('active vault pointer is unreadable')
    // ...and never to stdout, so JSON command output stays clean
    expect(stdout).not.toHaveBeenCalled()
  })

  it('does NOT swallow a failure to load the vault a valid pointer names', async () => {
    const setActiveVault = vi.fn()
    const getVaultById = vi.fn().mockRejectedValue(new StorageError(StorageErrorCode.Unknown, 'vault data unreadable'))
    const sdk = makeSdk({ get: vi.fn().mockResolvedValue('vault-1'), getVaultById, setActiveVault })

    // A readable pointer + broken vault data is a real error — it must surface,
    // and we must NOT delete the (good) pointer.
    await expect(loadActiveVaultSafely(sdk)).rejects.toThrow('vault data unreadable')
    expect(setActiveVault).not.toHaveBeenCalled()
  })

  it('tolerates a non-Error thrown value from the pointer read', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const sdk = makeSdk({
      get: vi.fn().mockRejectedValue('boom'),
      setActiveVault: vi.fn().mockResolvedValue(undefined),
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: true })
  })

  it('still fails open when self-heal itself fails', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const sdk = makeSdk({
      get: vi.fn().mockRejectedValue(new Error('corrupt')),
      setActiveVault: vi.fn().mockRejectedValue(new Error('read-only fs')),
    })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: true })
  })
})

describe('shouldAutoSelectActiveVault', () => {
  it('auto-selects on a fresh/normal "no active vault" state (not corrupt)', () => {
    expect(shouldAutoSelectActiveVault(false, false, 2)).toBe(true)
  })

  it('does NOT auto-select when the pointer was corrupt (fund-safety guard)', () => {
    // The security-relevant case: a corrupt pointer must not silently pick a
    // vault a later send/sign would then run against.
    expect(shouldAutoSelectActiveVault(false, true, 2)).toBe(false)
  })

  it('does not auto-select when a vault is already active', () => {
    expect(shouldAutoSelectActiveVault(true, false, 2)).toBe(false)
  })

  it('does not auto-select when there are no vaults', () => {
    expect(shouldAutoSelectActiveVault(false, false, 0)).toBe(false)
  })
})

/**
 * Wired through the real `Vultisig` SDK to prove the fix against the actual
 * pointer read / vault-list / self-heal code paths — not just a mocked helper.
 * `ThrowingStorage` reproduces what the Node `FileStorage` does with a garbage
 * `activeVaultId.json`: the read of that one key throws a `StorageError`, while
 * every other key behaves like a normal in-memory store.
 */
class ThrowingStorage implements VaultStorage {
  public readonly store = new Map<string, unknown>()
  public removed: string[] = []
  public corruptKey: string | null = 'activeVaultId'

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
  }
  async list(): Promise<string[]> {
    return [...this.store.keys()]
  }
  async clear(): Promise<void> {
    this.store.clear()
  }
}

/** Minimal unencrypted fast-vault record that `createVaultInstance` accepts. */
function mockVaultData(id: string, name: string) {
  return {
    id,
    name,
    publicKeys: { ecdsa: id, eddsa: `ed${id}` },
    hexChainCode: '0x123',
    signers: ['Server-1', 'Device-1'],
    localPartyId: 'Device-1',
    createdAt: 1_700_000_000_000,
    libType: 'GG20' as const,
    isBackedUp: true,
    order: 0,
    isEncrypted: false,
    type: 'fast' as const,
    currency: 'usd',
    chains: [] as string[],
    tokens: {},
    vultFileContent: '',
    lastModified: 1_700_000_000_000,
  }
}

describe('loadActiveVaultSafely (real Vultisig SDK)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('corrupt pointer + stored vaults: still lists every vault, none active, self-heals', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const storage = new ThrowingStorage()
    storage.store.set('vault:a', mockVaultData('a', 'Alpha'))
    storage.store.set('vault:b', mockVaultData('b', 'Beta'))
    const sdk = new Vultisig({ storage })

    // Sanity: the raw SDK read still throws — that is the bug the helper absorbs.
    await expect(sdk.getActiveVault()).rejects.toBeInstanceOf(StorageError)

    // Fail open: no active vault, flagged corrupt, bad pointer cleared.
    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: true })
    expect(storage.removed).toContain('activeVaultId')

    // Acceptance (a): the corrupt pointer no longer blocks access to the vaults
    // themselves — each is still resolvable (the enumeration `vaults` performs is
    // independent of the pointer). Uses getVaultById to stay off the WASM path.
    expect((await sdk.getVaultById('a'))?.name).toBe('Alpha')
    expect((await sdk.getVaultById('b'))?.name).toBe('Beta')
  })

  it('valid pointer resolves the named vault through the real SDK and does not self-heal', async () => {
    const storage = new ThrowingStorage()
    storage.corruptKey = null // pointer reads cleanly
    storage.store.set('vault:a', mockVaultData('a', 'Alpha'))
    storage.store.set('activeVaultId', 'a')
    const sdk = new Vultisig({ storage })

    // Acceptance (b): a valid pointer marks the active vault.
    const result = await loadActiveVaultSafely(sdk)
    expect(result.corruptPointer).toBe(false)
    expect(result.vault?.id).toBe('a')
    expect(storage.removed).not.toContain('activeVaultId')
  })

  it('dangling-but-valid pointer degrades to null without self-healing', async () => {
    const storage = new ThrowingStorage()
    storage.corruptKey = null
    storage.store.set('activeVaultId', 'nonexistent-vault-id')
    const sdk = new Vultisig({ storage })

    await expect(loadActiveVaultSafely(sdk)).resolves.toEqual({ vault: null, corruptPointer: false })
    expect(storage.removed).not.toContain('activeVaultId')
  })
})
