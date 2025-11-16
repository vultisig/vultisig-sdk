/**
 * BrowserStorage Tests
 *
 * Comprehensive tests for BrowserStorage with fake-indexeddb.
 * Tests IndexedDB mode, localStorage fallback, and memory fallback chain.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// Load fake-indexeddb FIRST (synchronously)
// Note: Using dynamic import at module level - this executes before tests run
if (typeof indexedDB === 'undefined') {
  await import('fake-indexeddb/auto')
}

// THEN import BrowserStorage (after globals exist)
import { BrowserStorage } from '@/runtime/storage/BrowserStorage'

describe('BrowserStorage', () => {
  let storage: BrowserStorage

  beforeEach(async () => {
    // Create fresh instance
    storage = new BrowserStorage()
    // BrowserStorage initializes asynchronously in constructor
    // Give it time to complete initialization
    await new Promise(resolve => setTimeout(resolve, 100))
  })

  afterEach(async () => {
    try {
      await storage.clear()
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Basic Operations', () => {
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

  describe('Concurrent Operations', () => {
    it('should handle concurrent writes', async () => {
      await Promise.all([
        storage.set('key1', 'value1'),
        storage.set('key2', 'value2'),
        storage.set('key3', 'value3'),
      ])

      expect(await storage.get('key1')).toBe('value1')
      expect(await storage.get('key2')).toBe('value2')
      expect(await storage.get('key3')).toBe('value3')
    })

    it('should handle concurrent reads', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      const [result1, result2] = await Promise.all([
        storage.get('key1'),
        storage.get('key2'),
      ])

      expect(result1).toBe('value1')
      expect(result2).toBe('value2')
    })
  })

  describe('Fallback Scenarios', () => {
    it('should fallback to memory when IndexedDB is unavailable', async () => {
      // Remove IndexedDB to force fallback
      const originalIndexedDB = (globalThis as any).indexedDB
      delete (globalThis as any).indexedDB

      // Create new storage instance (will fallback to localStorage then memory)
      const fallbackStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should still work (using localStorage or memory)
      await fallbackStorage.set('test-key', 'test-value')
      const result = await fallbackStorage.get<string>('test-key')
      expect(result).toBe('test-value')

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
    })

    it('should fallback to memory when both IndexedDB and localStorage are unavailable', async () => {
      // Remove both IndexedDB and localStorage
      const originalIndexedDB = (globalThis as any).indexedDB
      const originalLocalStorage = (globalThis as any).localStorage

      delete (globalThis as any).indexedDB
      delete (globalThis as any).localStorage

      // Create new storage instance (will use memory)
      const memoryStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Should still work in memory mode
      await memoryStorage.set('memory-key', 'memory-value')
      const result = await memoryStorage.get<string>('memory-key')
      expect(result).toBe('memory-value')

      // Memory storage should not persist across instances
      const newMemoryStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))
      const result2 = await newMemoryStorage.get<string>('memory-key')
      expect(result2).toBeNull()

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
      ;(globalThis as any).localStorage = originalLocalStorage
    })

    it('should allow operations after initialization even without persistence', async () => {
      const originalIndexedDB = (globalThis as any).indexedDB
      const originalLocalStorage = (globalThis as any).localStorage

      delete (globalThis as any).indexedDB
      delete (globalThis as any).localStorage

      const memoryStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      // All operations should work in memory mode
      await memoryStorage.set('key1', 'value1')
      await memoryStorage.set('key2', 'value2')
      expect(await memoryStorage.list()).toHaveLength(2)

      await memoryStorage.remove('key1')
      expect(await memoryStorage.list()).toHaveLength(1)

      await memoryStorage.clear()
      expect(await memoryStorage.list()).toHaveLength(0)

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
      ;(globalThis as any).localStorage = originalLocalStorage
    })

    it('should handle usage and quota in fallback modes', async () => {
      const originalIndexedDB = (globalThis as any).indexedDB
      delete (globalThis as any).indexedDB

      const fallbackStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      await fallbackStorage.set('key', 'value')

      // Usage should work in fallback mode
      const usage = await fallbackStorage.getUsage()
      expect(usage).toBeGreaterThanOrEqual(0)

      // Quota might be undefined in memory mode
      const quota = await fallbackStorage.getQuota()
      expect(quota === undefined || typeof quota === 'number').toBe(true)

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
    })

    it('should handle data types correctly in fallback mode', async () => {
      const originalIndexedDB = (globalThis as any).indexedDB
      delete (globalThis as any).indexedDB

      const fallbackStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Test various data types in fallback mode
      await fallbackStorage.set('string', 'test')
      await fallbackStorage.set('number', 42)
      await fallbackStorage.set('boolean', true)
      await fallbackStorage.set('object', { key: 'value' })
      await fallbackStorage.set('array', [1, 2, 3])
      await fallbackStorage.set('null', null)

      expect(await fallbackStorage.get('string')).toBe('test')
      expect(await fallbackStorage.get('number')).toBe(42)
      expect(await fallbackStorage.get('boolean')).toBe(true)
      expect(await fallbackStorage.get('object')).toEqual({ key: 'value' })
      expect(await fallbackStorage.get('array')).toEqual([1, 2, 3])
      expect(await fallbackStorage.get('null')).toBeNull()

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
    })

    it('should handle edge cases in fallback mode', async () => {
      const originalIndexedDB = (globalThis as any).indexedDB
      delete (globalThis as any).indexedDB

      const fallbackStorage = new BrowserStorage()
      await new Promise(resolve => setTimeout(resolve, 100))

      // Test edge cases
      await fallbackStorage.set('unicode-key-🔑', 'unicode-value-🌍')
      expect(await fallbackStorage.get('unicode-key-🔑')).toBe(
        'unicode-value-🌍'
      )

      await fallbackStorage.set('', 'empty-key')
      expect(await fallbackStorage.get('')).toBe('empty-key')

      await fallbackStorage.set('special:chars/test', 'value')
      expect(await fallbackStorage.get('special:chars/test')).toBe('value')

      // Restore
      ;(globalThis as any).indexedDB = originalIndexedDB
    })
  })
})
