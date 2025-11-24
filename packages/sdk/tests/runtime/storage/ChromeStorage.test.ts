/**
 * ChromeStorage Tests
 *
 * Comprehensive tests for ChromeStorage chrome.storage.local implementation.
 * Tests CRUD operations, StoredValue format, quota management, and change listeners.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChromeStorage } from '@/runtime/storage/ChromeStorage'
import { StorageErrorCode } from '@/runtime/storage/types'

import { resetChromeStorage, setupChromeStorage } from '../mocks/browser-apis'

describe('ChromeStorage', () => {
  let storage: ChromeStorage

  beforeEach(() => {
    // Setup chrome.storage.local mock
    setupChromeStorage()
    storage = new ChromeStorage()
  })

  afterEach(() => {
    resetChromeStorage()
  })

  describe('Constructor & API Availability', () => {
    it('should throw error if chrome.storage.local is unavailable', () => {
      // Remove chrome global
      delete (globalThis as any).chrome

      expect(() => new ChromeStorage()).toThrow()
      expect(() => new ChromeStorage()).toThrowError(/not available/)
    })

    it('should initialize successfully when API is available', () => {
      // Already setup in beforeEach
      expect(storage).toBeInstanceOf(ChromeStorage)
    })
  })

  describe('Basic CRUD Operations', () => {
    it('should store and retrieve a string value', async () => {
      await storage.set('test-key', 'test-value')
      const result = await storage.get<string>('test-key')
      expect(result).toBe('test-value')
    })

    it('should store and retrieve a number value', async () => {
      await storage.set('number-key', 42)
      const result = await storage.get<number>('number-key')
      expect(result).toBe(42)
    })

    it('should store and retrieve an object', async () => {
      const obj = { name: 'Test', value: 123 }
      await storage.set('object-key', obj)
      const result = await storage.get('object-key')
      expect(result).toEqual(obj)
    })

    it('should store and retrieve an array', async () => {
      const arr = [1, 2, 3, 4, 5]
      await storage.set('array-key', arr)
      const result = await storage.get<number[]>('array-key')
      expect(result).toEqual(arr)
    })

    it('should return null for non-existent key', async () => {
      const result = await storage.get('non-existent')
      expect(result).toBeNull()
    })

    it('should update existing value', async () => {
      await storage.set('key', 'value1')
      await storage.set('key', 'value2')
      const result = await storage.get<string>('key')
      expect(result).toBe('value2')
    })

    it('should store values in StoredValue wrapper format', async () => {
      await storage.set('wrapped-key', 'wrapped-value')

      // Directly check chrome.storage.local
      const rawResult = await chrome.storage.local.get('wrapped-key')
      const stored = rawResult['wrapped-key']

      expect(stored).toHaveProperty('value', 'wrapped-value')
      expect(stored).toHaveProperty('metadata')
      expect(stored.metadata).toHaveProperty('version')
      expect(stored.metadata).toHaveProperty('createdAt')
      expect(stored.metadata).toHaveProperty('lastModified')
    })
  })

  describe('Remove Operations', () => {
    it('should remove a key', async () => {
      await storage.set('test-key', 'test-value')
      await storage.remove('test-key')
      const result = await storage.get('test-key')
      expect(result).toBeNull()
    })

    it('should not throw when removing non-existent key', async () => {
      await expect(storage.remove('non-existent')).resolves.not.toThrow()
    })

    it('should remove only specified key', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.remove('key1')

      expect(await storage.get('key1')).toBeNull()
      expect(await storage.get('key2')).toBe('value2')
    })
  })

  describe('List Operations', () => {
    it('should list all keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      const keys = await storage.list()
      expect(keys).toHaveLength(3)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should return empty array when no keys', async () => {
      const keys = await storage.list()
      expect(keys).toEqual([])
    })

    it('should update list after adding keys', async () => {
      expect(await storage.list()).toHaveLength(0)

      await storage.set('key1', 'value1')
      expect(await storage.list()).toHaveLength(1)

      await storage.set('key2', 'value2')
      expect(await storage.list()).toHaveLength(2)
    })

    it('should update list after removing keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      expect(await storage.list()).toHaveLength(2)

      await storage.remove('key1')
      expect(await storage.list()).toHaveLength(1)
    })
  })

  describe('Clear Operations', () => {
    it('should clear all keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      await storage.clear()
      const keys = await storage.list()
      expect(keys).toEqual([])
    })

    it('should allow adding keys after clear', async () => {
      await storage.set('key1', 'value1')
      await storage.clear()
      await storage.set('key2', 'value2')

      const result = await storage.get<string>('key2')
      expect(result).toBe('value2')
    })

    it('should not throw on empty storage', async () => {
      await expect(storage.clear()).resolves.not.toThrow()
    })
  })

  describe('Backwards Compatibility', () => {
    it('should read legacy values without StoredValue wrapper', async () => {
      // Manually insert legacy format (direct value without wrapper)
      await chrome.storage.local.set({ 'legacy-key': 'legacy-value' })

      const result = await storage.get<string>('legacy-key')
      expect(result).toBe('legacy-value')
    })

    it('should read legacy objects without wrapper', async () => {
      const legacyObj = { name: 'Legacy', count: 99 }
      await chrome.storage.local.set({ 'legacy-object': legacyObj })

      const result = await storage.get('legacy-object')
      expect(result).toEqual(legacyObj)
    })

    it('should migrate legacy values on write', async () => {
      // Insert legacy value
      await chrome.storage.local.set({ 'legacy-key': 'legacy-value' })

      // Read it (should work)
      expect(await storage.get<string>('legacy-key')).toBe('legacy-value')

      // Update it (should wrap in StoredValue)
      await storage.set('legacy-key', 'new-value')

      // Verify it's now wrapped
      const rawResult = await chrome.storage.local.get('legacy-key')
      const stored = rawResult['legacy-key']
      expect(stored).toHaveProperty('value', 'new-value')
      expect(stored).toHaveProperty('metadata')
    })
  })

  describe('Quota Management', () => {
    it('should return default quota (10MB)', async () => {
      const quota = await storage.getQuota()
      expect(quota).toBe(10 * 1024 * 1024) // 10MB
    })

    it('should calculate usage with getBytesInUse', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      const usage = await storage.getUsage()
      expect(usage).toBeGreaterThan(0)
    })

    it('should increase usage when adding data', async () => {
      const usageBefore = await storage.getUsage()

      await storage.set('large-key', 'x'.repeat(1000))
      const usageAfter = await storage.getUsage()

      expect(usageAfter).toBeGreaterThan(usageBefore)
    })

    it('should check for unlimitedStorage permission', async () => {
      // Mock chrome.permissions
      ;(globalThis as any).chrome.permissions = {
        getAll: vi.fn(async () => ({
          permissions: ['unlimitedStorage'],
        })),
      }

      const hasUnlimited = await storage.hasUnlimitedStorage()
      expect(hasUnlimited).toBe(true)
    })

    it('should return false for unlimitedStorage when permission not granted', async () => {
      // Mock chrome.permissions without unlimitedStorage
      ;(globalThis as any).chrome.permissions = {
        getAll: vi.fn(async () => ({
          permissions: ['storage'],
        })),
      }

      const hasUnlimited = await storage.hasUnlimitedStorage()
      expect(hasUnlimited).toBe(false)
    })

    it('should return false when chrome.permissions API unavailable', async () => {
      // Remove permissions API
      delete (globalThis as any).chrome.permissions

      const hasUnlimited = await storage.hasUnlimitedStorage()
      expect(hasUnlimited).toBe(false)
    })
  })

  describe('Change Listeners (onChanged)', () => {
    it('should add listener and receive change events on set', async () => {
      const changeCallback = vi.fn()
      const unsubscribe = storage.onChanged(changeCallback)

      await storage.set('key1', 'value1')

      // Wait for listener to be called
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(changeCallback).toHaveBeenCalled()
      const changes = changeCallback.mock.calls[0][0]
      expect(changes).toHaveProperty('key1')
      expect(changes.key1).toHaveProperty('newValue')

      unsubscribe()
    })

    it('should receive change events on remove', async () => {
      await storage.set('key1', 'value1')

      const changeCallback = vi.fn()
      const unsubscribe = storage.onChanged(changeCallback)

      await storage.remove('key1')

      // Wait for listener
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(changeCallback).toHaveBeenCalled()
      const changes = changeCallback.mock.calls[0][0]
      expect(changes).toHaveProperty('key1')
      expect(changes.key1).toHaveProperty('oldValue')

      unsubscribe()
    })

    it('should receive change events on clear', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      const changeCallback = vi.fn()
      const unsubscribe = storage.onChanged(changeCallback)

      await storage.clear()

      // Wait for listener
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(changeCallback).toHaveBeenCalled()
      const changes = changeCallback.mock.calls[0][0]
      expect(changes).toHaveProperty('key1')
      expect(changes).toHaveProperty('key2')

      unsubscribe()
    })

    it('should support multiple listeners', async () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()

      const unsub1 = storage.onChanged(callback1)
      const unsub2 = storage.onChanged(callback2)

      await storage.set('key', 'value')

      // Wait for listeners
      await new Promise(resolve => setTimeout(resolve, 10))

      expect(callback1).toHaveBeenCalled()
      expect(callback2).toHaveBeenCalled()

      unsub1()
      unsub2()
    })

    it('should stop receiving events after unsubscribe', async () => {
      const changeCallback = vi.fn()
      const unsubscribe = storage.onChanged(changeCallback)

      await storage.set('key1', 'value1')
      await new Promise(resolve => setTimeout(resolve, 10))

      const callCountBefore = changeCallback.mock.calls.length
      expect(callCountBefore).toBeGreaterThan(0)

      // Unsubscribe
      unsubscribe()

      // Make more changes
      await storage.set('key2', 'value2')
      await new Promise(resolve => setTimeout(resolve, 10))

      // Callback should not be called again
      expect(changeCallback.mock.calls.length).toBe(callCountBefore)
    })

    it('should only fire for "local" storage area', async () => {
      const changeCallback = vi.fn()
      const unsubscribe = storage.onChanged(changeCallback)

      // Manually trigger change for different area (like 'sync')
      const listeners = (chrome.storage.onChanged as any)._listeners || []
      if (listeners.length > 0) {
        listeners[0]({ key: { newValue: 'value' } }, 'sync')
      }

      await new Promise(resolve => setTimeout(resolve, 10))

      // Should not be called for 'sync' area
      expect(changeCallback).not.toHaveBeenCalled()

      unsubscribe()
    })
  })

  describe('Error Handling', () => {
    it('should throw error when quota exceeded', async () => {
      // Mock set to throw quota error
      const originalSet = chrome.storage.local.set
      chrome.storage.local.set = vi.fn().mockRejectedValue(new Error('QUOTA_BYTES exceeded'))

      await expect(storage.set('key', 'value')).rejects.toMatchObject({
        code: StorageErrorCode.QuotaExceeded,
      })

      // Restore
      chrome.storage.local.set = originalSet
    })

    it('should handle API errors gracefully', async () => {
      // Mock get to throw error
      const originalGet = chrome.storage.local.get
      chrome.storage.local.get = vi.fn().mockRejectedValue(new Error('API Error'))

      await expect(storage.get('key')).rejects.toThrow()

      // Restore
      chrome.storage.local.get = originalGet
    })

    it('should handle concurrent operations', async () => {
      await Promise.all([storage.set('key1', 'value1'), storage.set('key2', 'value2'), storage.set('key3', 'value3')])

      expect(await storage.get('key1')).toBe('value1')
      expect(await storage.get('key2')).toBe('value2')
      expect(await storage.get('key3')).toBe('value3')
    })
  })

  describe('Data Types', () => {
    it('should handle boolean values', async () => {
      await storage.set('bool-true', true)
      await storage.set('bool-false', false)

      expect(await storage.get('bool-true')).toBe(true)
      expect(await storage.get('bool-false')).toBe(false)
    })

    it('should handle null value', async () => {
      await storage.set('null-key', null)
      const result = await storage.get('null-key')
      expect(result).toBeNull()
    })

    it('should handle nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      }
      await storage.set('nested', nested)
      const result = await storage.get('nested')
      expect(result).toEqual(nested)
    })

    it('should handle arrays of objects', async () => {
      const arr = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ]
      await storage.set('array-objects', arr)
      const result = await storage.get('array-objects')
      expect(result).toEqual(arr)
    })
  })

  describe('Edge Cases', () => {
    it('should handle keys with special characters', async () => {
      const key = 'key-with-special:chars/and\\backslash'
      await storage.set(key, 'value')
      expect(await storage.get(key)).toBe('value')
    })

    it('should handle Unicode in keys', async () => {
      await storage.set('key-🔑', 'value')
      expect(await storage.get('key-🔑')).toBe('value')
    })

    it('should handle Unicode in values', async () => {
      await storage.set('key', '你好世界 🌍')
      expect(await storage.get('key')).toBe('你好世界 🌍')
    })

    it('should handle empty string as key', async () => {
      await storage.set('', 'empty-key-value')
      expect(await storage.get('')).toBe('empty-key-value')
    })

    it('should handle empty string as value', async () => {
      await storage.set('empty-value', '')
      expect(await storage.get('empty-value')).toBe('')
    })

    it('should handle large values', async () => {
      const largeValue = 'x'.repeat(10000) // 10KB
      await storage.set('large', largeValue)
      const result = await storage.get<string>('large')
      expect(result).toBe(largeValue)
    })
  })

  describe('Type Safety', () => {
    it('should preserve types with generics', async () => {
      type TestType = {
        id: number
        name: string
      }

      const value: TestType = { id: 1, name: 'Test' }
      await storage.set<TestType>('typed', value)
      const result = await storage.get<TestType>('typed')

      expect(result).toEqual(value)
      if (result) {
        expect(result.id).toBe(1)
        expect(result.name).toBe('Test')
      }
    })
  })
})
