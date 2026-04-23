import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @react-native-async-storage/async-storage before importing ReactNativeStorage.
//
// The mock mirrors the REAL AsyncStorage API surface: `multiRemove` (plural-
// style bulk remove), NOT `removeMany` (which does not exist). Any call to a
// method we didn't declare here will throw `multiRemove is not a function`
// at runtime, which is exactly the failure mode that shipped in the previous
// iteration of ReactNativeStorage.clear().
const mockStore = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mockStore.set(key, value)
    }),
    removeItem: vi.fn(async (key: string) => {
      mockStore.delete(key)
    }),
    getAllKeys: vi.fn(async () => Array.from(mockStore.keys())),
    multiRemove: vi.fn(async (keys: string[]) => {
      for (const k of keys) mockStore.delete(k)
    }),
    clear: vi.fn(async () => {
      mockStore.clear()
    }),
  },
}))

const { ReactNativeStorage } = await import('../../../../src/platforms/react-native/storage')

describe('ReactNativeStorage', () => {
  let storage: InstanceType<typeof ReactNativeStorage>

  beforeEach(() => {
    mockStore.clear()
    storage = new ReactNativeStorage()
  })

  it('returns null for missing key', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('round-trips a value', async () => {
    await storage.set('key1', { a: 1 })
    expect(await storage.get<{ a: number }>('key1')).toEqual({ a: 1 })
  })

  it('removes a value', async () => {
    await storage.set('key1', 'value')
    await storage.remove('key1')
    expect(await storage.get('key1')).toBeNull()
  })

  it('lists stored keys without the internal prefix', async () => {
    await storage.set('alpha', 1)
    await storage.set('beta', 2)
    expect((await storage.list()).sort()).toEqual(['alpha', 'beta'])
  })

  it('ignores keys outside the vultisig namespace when listing', async () => {
    await storage.set('mine', 1)
    mockStore.set('other-app:foo', 'bar')
    expect(await storage.list()).toEqual(['mine'])
  })

  it('clears only its own namespaced keys', async () => {
    await storage.set('mine', 1)
    mockStore.set('other-app:foo', 'bar')
    await storage.clear()
    expect(await storage.list()).toEqual([])
    expect(mockStore.has('other-app:foo')).toBe(true)
  })

  it('clear() calls AsyncStorage.multiRemove (not the non-existent removeMany)', async () => {
    // Regression guard: the previous implementation called
    // `AsyncStorage.removeMany`, which threw `... is not a function` on every
    // consumer the moment they invoked `storage.clear()`. Assert that the
    // correct API (`multiRemove`) is actually reached.
    const mod = await import('@react-native-async-storage/async-storage')
    const AsyncStorage = mod.default
    const spy = vi.mocked(AsyncStorage.multiRemove)
    spy.mockClear()

    await storage.set('k1', 1)
    await storage.set('k2', 2)
    await storage.clear()

    expect(spy).toHaveBeenCalledTimes(1)
    const [keysArg] = spy.mock.calls[0]! as [string[]]
    expect(keysArg.sort()).toEqual(['vultisig:k1', 'vultisig:k2'])
  })
})
