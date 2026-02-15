import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChromeExtensionStorage } from '../../../../src/platforms/chrome-extension/storage'
import { StorageError, StorageErrorCode } from '../../../../src/storage/types'

// Mock chrome.storage.local
const mockStorage = new Map<string, any>()

const mockChromeStorageLocal = {
  get: vi.fn(async (key: string | null) => {
    if (key === null) {
      return Object.fromEntries(mockStorage)
    }
    const value = mockStorage.get(key)
    return value !== undefined ? { [key]: value } : {}
  }),
  set: vi.fn(async (items: Record<string, any>) => {
    for (const [key, value] of Object.entries(items)) {
      mockStorage.set(key, value)
    }
  }),
  remove: vi.fn(async (key: string) => {
    mockStorage.delete(key)
  }),
  clear: vi.fn(async () => {
    mockStorage.clear()
  }),
  getBytesInUse: vi.fn(async () => 1024),
  QUOTA_BYTES: 10485760,
}

// Install mock on globalThis
;(globalThis as any).chrome = {
  storage: {
    local: mockChromeStorageLocal,
  },
}

describe('ChromeExtensionStorage', () => {
  let storage: ChromeExtensionStorage

  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
    storage = new ChromeExtensionStorage()
  })

  describe('get', () => {
    it('should return null for non-existent key', async () => {
      const result = await storage.get('nonexistent')
      expect(result).toBeNull()
    })

    it('should return stored value', async () => {
      mockStorage.set('test-key', {
        value: { name: 'test vault' },
        metadata: { version: 1, createdAt: 1000, lastModified: 1000 },
      })

      const result = await storage.get<{ name: string }>('test-key')
      expect(result).toEqual({ name: 'test vault' })
    })

    it('should unwrap StoredValue envelope', async () => {
      mockStorage.set('key', {
        value: 42,
        metadata: { version: 1, createdAt: 1000, lastModified: 1000 },
      })

      const result = await storage.get<number>('key')
      expect(result).toBe(42)
    })
  })

  describe('set', () => {
    it('should store value with metadata', async () => {
      await storage.set('key', { name: 'vault' })

      expect(mockChromeStorageLocal.set).toHaveBeenCalledWith({
        key: expect.objectContaining({
          value: { name: 'vault' },
          metadata: expect.objectContaining({
            version: 1,
            createdAt: expect.any(Number),
            lastModified: expect.any(Number),
          }),
        }),
      })
    })

    it('should throw QuotaExceeded for quota errors', async () => {
      mockChromeStorageLocal.set.mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'))

      try {
        await storage.set('key', 'value')
        expect.unreachable('should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(StorageError)
        expect((error as StorageError).code).toBe(StorageErrorCode.QuotaExceeded)
      }
    })
  })

  describe('remove', () => {
    it('should remove a key', async () => {
      mockStorage.set('key', { value: 'data', metadata: {} })
      await storage.remove('key')
      expect(mockChromeStorageLocal.remove).toHaveBeenCalledWith('key')
    })
  })

  describe('list', () => {
    it('should return all keys', async () => {
      mockStorage.set('vault-1', { value: 'a', metadata: {} })
      mockStorage.set('vault-2', { value: 'b', metadata: {} })

      const keys = await storage.list()
      expect(keys).toEqual(['vault-1', 'vault-2'])
    })

    it('should return empty array when no keys', async () => {
      const keys = await storage.list()
      expect(keys).toEqual([])
    })
  })

  describe('clear', () => {
    it('should clear all storage', async () => {
      mockStorage.set('key', 'value')
      await storage.clear()
      expect(mockChromeStorageLocal.clear).toHaveBeenCalled()
    })
  })

  describe('getUsage', () => {
    it('should return bytes in use', async () => {
      const usage = await storage.getUsage()
      expect(usage).toBe(1024)
    })
  })

  describe('getQuota', () => {
    it('should return QUOTA_BYTES', async () => {
      const quota = await storage.getQuota()
      expect(quota).toBe(10485760)
    })
  })

  describe('availability check', () => {
    it('should throw StorageUnavailable when chrome.storage.local is missing', async () => {
      const originalChrome = (globalThis as any).chrome
      ;(globalThis as any).chrome = undefined

      const unavailableStorage = new ChromeExtensionStorage()

      await expect(unavailableStorage.get('key')).rejects.toThrow(StorageError)
      await expect(unavailableStorage.get('key').catch(e => e.code)).resolves.toBe(StorageErrorCode.StorageUnavailable)
      ;(globalThis as any).chrome = originalChrome
    })
  })
})
