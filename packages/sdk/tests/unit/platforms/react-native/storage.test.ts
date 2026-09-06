import { beforeEach, describe, expect, it, vi } from 'vitest'

import { StorageErrorCode } from '../../../../src/storage/types'

const mockLegacyStore = new Map<string, string>()
const mockSqliteValues = new Map<string, string>()
const mockSqliteMigrations = new Set<string>()
let mockSqliteTail = Promise.resolve()
let mockCommitFailure: Error | undefined
let mockLegacyRemoveFailure: Error | undefined

type FakeDatabaseState = {
  migrations: Set<string>
  values: Map<string, string>
}

function fakeDatabase(state: FakeDatabaseState) {
  return {
    execAsync: vi.fn(async () => {}),
    getAllAsync: vi.fn(async (source: string) => {
      if (!source.includes('FROM storage_values')) throw new Error(`Unexpected getAllAsync SQL: ${source}`)
      return Array.from(state.values.keys(), key => ({ key }))
    }),
    getFirstAsync: vi.fn(async (source: string, key: string) => {
      if (source.includes('FROM storage_migrations')) {
        return state.migrations.has(key) ? { name: key } : null
      }
      if (source.includes('FROM storage_values')) {
        const payload = state.values.get(key)
        return payload === undefined ? null : { payload }
      }
      throw new Error(`Unexpected getFirstAsync SQL: ${source}`)
    }),
    runAsync: vi.fn(async (source: string, ...params: unknown[]) => {
      if (source.startsWith('INSERT OR IGNORE INTO storage_values')) {
        const [key, payload] = params as [string, string]
        if (!state.values.has(key)) state.values.set(key, payload)
        return {}
      }
      if (source.startsWith('INSERT OR REPLACE INTO storage_values')) {
        const [key, payload] = params as [string, string]
        state.values.set(key, payload)
        return {}
      }
      if (source.includes('INTO storage_migrations')) {
        state.migrations.add(params[0] as string)
        return {}
      }
      if (source.startsWith('DELETE FROM storage_values WHERE')) {
        state.values.delete(params[0] as string)
        return {}
      }
      if (source === 'DELETE FROM storage_values') {
        state.values.clear()
        return {}
      }
      throw new Error(`Unexpected runAsync SQL: ${source}`)
    }),
  }
}

const mockDatabase = fakeDatabase({ migrations: mockSqliteMigrations, values: mockSqliteValues })
const mockWithExclusiveTransactionAsync = vi.fn(
  async (task: (transaction: ReturnType<typeof fakeDatabase>) => Promise<void>) => {
    const previous = mockSqliteTail
    let release!: () => void
    const current = new Promise<void>(resolve => {
      release = resolve
    })
    mockSqliteTail = previous.then(() => current)

    await previous
    try {
      const pendingState = {
        migrations: new Set(mockSqliteMigrations),
        values: new Map(mockSqliteValues),
      }
      await task(fakeDatabase(pendingState))
      if (mockCommitFailure) {
        const error = mockCommitFailure
        mockCommitFailure = undefined
        throw error
      }
      mockSqliteMigrations.clear()
      for (const migration of pendingState.migrations) mockSqliteMigrations.add(migration)
      mockSqliteValues.clear()
      for (const [key, payload] of pendingState.values) mockSqliteValues.set(key, payload)
    } finally {
      release()
    }
  }
)

vi.mock('expo-sqlite', () => ({
  openDatabaseAsync: vi.fn(async () => ({
    ...mockDatabase,
    withExclusiveTransactionAsync: mockWithExclusiveTransactionAsync,
  })),
}))

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockLegacyStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockLegacyStore.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      if (mockLegacyRemoveFailure) {
        const error = mockLegacyRemoveFailure
        mockLegacyRemoveFailure = undefined
        throw error
      }
      mockLegacyStore.delete(key)
    }),
    getAllKeys: vi.fn(async () => Array.from(mockLegacyStore.keys())),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const key of keys) mockLegacyStore.delete(key)
    }),
  },
}))

type ReactNativeStorageClass = typeof import('../../../../src/platforms/react-native/storage').ReactNativeStorage

describe('ReactNativeStorage', () => {
  let ReactNativeStorage: ReactNativeStorageClass
  let storage: InstanceType<ReactNativeStorageClass>

  beforeEach(async () => {
    vi.resetModules()
    mockLegacyStore.clear()
    mockSqliteValues.clear()
    mockSqliteMigrations.clear()
    mockSqliteTail = Promise.resolve()
    mockCommitFailure = undefined
    mockLegacyRemoveFailure = undefined
    mockWithExclusiveTransactionAsync.mockClear()
    ;({ ReactNativeStorage } = await import('../../../../src/platforms/react-native/storage'))
    storage = new ReactNativeStorage()
  })

  it('returns null for missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('migrates existing AsyncStorage values once and then reads the transactional copy', async () => {
    mockLegacyStore.set(
      'vultisig:legacy',
      JSON.stringify({
        value: { name: 'legacy vault' },
        metadata: { version: 1, createdAt: 1, lastModified: 1 },
      })
    )
    mockLegacyStore.set('other-app:key', 'untouched')

    await expect(storage.get('legacy')).resolves.toEqual({ name: 'legacy vault' })
    expect(mockLegacyStore.has('vultisig:legacy')).toBe(false)
    await expect(storage.get('legacy')).resolves.toEqual({ name: 'legacy vault' })
    expect(mockLegacyStore.get('other-app:key')).toBe('untouched')
    expect(mockSqliteValues.has('other-app:key')).toBe(false)
  })

  it('retries interrupted legacy cleanup before exposing the migrated database', async () => {
    mockLegacyStore.set(
      'vultisig:legacy',
      JSON.stringify({
        value: { name: 'legacy vault' },
        metadata: { version: 1, createdAt: 1, lastModified: 1 },
      })
    )
    mockLegacyRemoveFailure = new Error('cleanup interrupted')

    await expect(storage.get('legacy')).rejects.toMatchObject({ code: StorageErrorCode.Unknown })
    expect(mockSqliteValues.has('legacy')).toBe(true)
    expect(mockLegacyStore.has('vultisig:legacy')).toBe(true)

    await expect(storage.get('legacy')).resolves.toEqual({ name: 'legacy vault' })
    expect(mockLegacyStore.has('vultisig:legacy')).toBe(false)
  })

  it('round-trips a value', async () => {
    await storage.set('key1', { a: 1 })
    expect(await storage.get<{ a: number }>('key1')).toEqual({ a: 1 })
  })

  it('conditionally writes exactly one value across adapter instances through native transactions', async () => {
    const other = new ReactNativeStorage()

    const results = await Promise.all([
      storage.compareAndSet('vault:shared', null, { owner: 'first' }),
      other.compareAndSet('vault:shared', null, { owner: 'second' }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await storage.get('vault:shared')).toEqual(results[0] ? { owner: 'first' } : { owner: 'second' })
    expect(mockWithExclusiveTransactionAsync).toHaveBeenCalledTimes(4)
  })

  it('rolls the value back when the native transaction fails while committing', async () => {
    await storage.set('vault:existing', { version: 1 })
    mockCommitFailure = new Error('commit failed')

    await expect(storage.compareAndSet('vault:existing', { version: 1 }, { version: 2 })).rejects.toMatchObject({
      code: StorageErrorCode.Unknown,
    })
    await expect(storage.get('vault:existing')).resolves.toEqual({ version: 1 })
  })

  it('does not overwrite a value when the expected JSON value differs', async () => {
    await storage.set('vault:existing', { version: 1 })

    await expect(storage.compareAndSet('vault:existing', { version: 2 }, { version: 3 })).resolves.toBe(false)
    await expect(storage.get('vault:existing')).resolves.toEqual({ version: 1 })
  })

  it('removes a value', async () => {
    await storage.set('key1', 'value')
    await storage.remove('key1')
    await expect(storage.get('key1')).resolves.toBeNull()
  })

  it('lists stored keys without an internal prefix', async () => {
    await storage.set('alpha', 1)
    await storage.set('beta', 2)
    expect((await storage.list()).sort()).toEqual(['alpha', 'beta'])
  })

  it('clears every SDK value without touching unrelated legacy storage', async () => {
    await storage.set('mine', 1)
    mockLegacyStore.set('other-app:foo', 'bar')

    await storage.clear()

    await expect(storage.list()).resolves.toEqual([])
    expect(mockLegacyStore.get('other-app:foo')).toBe('bar')
  })
})
