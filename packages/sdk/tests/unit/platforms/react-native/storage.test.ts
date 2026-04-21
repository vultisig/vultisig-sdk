import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock @react-native-async-storage/async-storage before importing ReactNativeStorage
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
    removeMany: vi.fn(async (keys: string[]) => {
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
})
