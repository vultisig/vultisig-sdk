/**
 * Unit Tests for MemoryStorage
 *
 * Tests the MemoryStorage class which provides in-memory storage implementation
 * for testing and temporary vaults. Data is lost when the application closes.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { MemoryStorage } from '@/runtime/storage/MemoryStorage'
import { STORAGE_VERSION } from '@/runtime/storage/types'

describe('MemoryStorage', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
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

    it('should store and retrieve an object value', async () => {
      const obj = { name: 'Test Vault', count: 5, active: true }
      await storage.set('object-key', obj)
      const result = await storage.get<typeof obj>('object-key')

      expect(result).toEqual(obj)
    })

    it('should store and retrieve an array value', async () => {
      const arr = [1, 2, 3, 4, 5]
      await storage.set('array-key', arr)
      const result = await storage.get<typeof arr>('array-key')

      expect(result).toEqual(arr)
    })

    it('should return null for non-existent key', async () => {
      const result = await storage.get<string>('non-existent')

      expect(result).toBeNull()
    })

    it('should update existing value', async () => {
      await storage.set('update-key', 'original')
      await storage.set('update-key', 'updated')
      const result = await storage.get<string>('update-key')

      expect(result).toBe('updated')
    })

    it('should remove a key', async () => {
      await storage.set('remove-key', 'value')
      await storage.remove('remove-key')
      const result = await storage.get<string>('remove-key')

      expect(result).toBeNull()
    })

    it('should handle removing non-existent key without error', async () => {
      await expect(storage.remove('non-existent')).resolves.toBeUndefined()
    })
  })

  describe('List Operations', () => {
    it('should return empty array when no keys exist', async () => {
      const keys = await storage.list()

      expect(keys).toEqual([])
    })

    it('should list all stored keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      const keys = await storage.list()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should list keys in insertion order', async () => {
      await storage.set('first', 1)
      await storage.set('second', 2)
      await storage.set('third', 3)

      const keys = await storage.list()

      expect(keys).toEqual(['first', 'second', 'third'])
    })

    it('should not include removed keys in list', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.remove('key1')

      const keys = await storage.list()

      expect(keys).toEqual(['key2'])
    })

    it('should update list when keys are added after listing', async () => {
      await storage.set('key1', 'value1')
      const keys1 = await storage.list()
      await storage.set('key2', 'value2')
      const keys2 = await storage.list()

      expect(keys1).toHaveLength(1)
      expect(keys2).toHaveLength(2)
    })
  })

  describe('Clear Operations', () => {
    it('should clear all stored values', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      await storage.clear()

      const keys = await storage.list()
      expect(keys).toHaveLength(0)
    })

    it('should allow setting values after clear', async () => {
      await storage.set('key1', 'value1')
      await storage.clear()
      await storage.set('key2', 'value2')

      const result = await storage.get<string>('key2')
      expect(result).toBe('value2')
    })

    it('should handle clear on empty storage', async () => {
      await expect(storage.clear()).resolves.toBeUndefined()
      const keys = await storage.list()
      expect(keys).toHaveLength(0)
    })
  })

  describe('Usage Estimation', () => {
    it('should return 0 usage for empty storage', async () => {
      const usage = await storage.getUsage()

      expect(usage).toBe(0)
    })

    it('should estimate usage for string storage', async () => {
      await storage.set('test', 'value')

      const usage = await storage.getUsage()

      expect(usage).toBeGreaterThan(0)
    })

    it('should increase usage when more items are added', async () => {
      await storage.set('key1', 'value1')
      const usage1 = await storage.getUsage()

      await storage.set('key2', 'value2')
      const usage2 = await storage.getUsage()

      expect(usage2).toBeGreaterThan(usage1)
    })

    it('should decrease usage when items are removed', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      const usage1 = await storage.getUsage()

      await storage.remove('key1')
      const usage2 = await storage.getUsage()

      expect(usage2).toBeLessThan(usage1)
    })

    it('should return 0 usage after clear', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.clear()

      const usage = await storage.getUsage()

      expect(usage).toBe(0)
    })

    it('should account for key size in usage calculation', async () => {
      await storage.set('short', 'value')
      const usage1 = await storage.getUsage()

      await storage.clear()
      await storage.set('very-long-key-name-for-testing', 'value')
      const usage2 = await storage.getUsage()

      expect(usage2).toBeGreaterThan(usage1)
    })

    it('should account for value size in usage calculation', async () => {
      await storage.set('key', 'small')
      const usage1 = await storage.getUsage()

      await storage.clear()
      await storage.set('key', 'much longer value for testing size calculation')
      const usage2 = await storage.getUsage()

      expect(usage2).toBeGreaterThan(usage1)
    })

    it('should handle usage estimation for complex objects', async () => {
      const complexObj = {
        name: 'Complex Object',
        nested: { data: [1, 2, 3], active: true },
        metadata: { created: Date.now(), version: '1.0' },
      }

      await storage.set('complex', complexObj)

      const usage = await storage.getUsage()

      expect(usage).toBeGreaterThan(0)
    })
  })

  describe('Quota', () => {
    it('should return undefined for quota (no memory limit)', async () => {
      const quota = await storage.getQuota()

      expect(quota).toBeUndefined()
    })

    it('should return undefined quota even with stored data', async () => {
      await storage.set('key', 'value')

      const quota = await storage.getQuota()

      expect(quota).toBeUndefined()
    })
  })

  describe('Metadata Tracking', () => {
    it('should preserve createdAt timestamp when updating value', async () => {
      await storage.set('meta-key', 'original')

      // Wait a bit to ensure timestamps differ
      await new Promise(resolve => setTimeout(resolve, 10))

      await storage.set('meta-key', 'updated')

      // Access internal store to check metadata (implementation detail test)
      const stored = (storage as any).store.get('meta-key')
      expect(stored.metadata.createdAt).toBeLessThan(stored.metadata.lastModified)
    })

    it('should set lastModified timestamp on each update', async () => {
      await storage.set('meta-key', 'value1')
      const stored1 = (storage as any).store.get('meta-key')

      await new Promise(resolve => setTimeout(resolve, 10))

      await storage.set('meta-key', 'value2')
      const stored2 = (storage as any).store.get('meta-key')

      expect(stored2.metadata.lastModified).toBeGreaterThan(stored1.metadata.lastModified)
    })

    it('should include storage version in metadata', async () => {
      await storage.set('version-key', 'value')

      const stored = (storage as any).store.get('version-key')
      expect(stored.metadata.version).toBe(STORAGE_VERSION)
    })

    it('should set createdAt on first set', async () => {
      const beforeTime = Date.now()
      await storage.set('new-key', 'value')
      const afterTime = Date.now()

      const stored = (storage as any).store.get('new-key')
      expect(stored.metadata.createdAt).toBeGreaterThanOrEqual(beforeTime)
      expect(stored.metadata.createdAt).toBeLessThanOrEqual(afterTime)
    })
  })

  describe('Data Types', () => {
    it('should handle boolean values', async () => {
      await storage.set('bool-true', true)
      await storage.set('bool-false', false)

      expect(await storage.get<boolean>('bool-true')).toBe(true)
      expect(await storage.get<boolean>('bool-false')).toBe(false)
    })

    it('should handle null values', async () => {
      await storage.set('null-key', null)

      const result = await storage.get('null-key')
      expect(result).toBeNull()
    })

    it('should handle undefined values', async () => {
      await storage.set('undefined-key', undefined)

      const result = await storage.get('undefined-key')
      expect(result).toBeUndefined()
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

      const result = await storage.get<typeof nested>('nested')
      expect(result).toEqual(nested)
      expect(result?.level1.level2.level3.value).toBe('deep')
    })

    it('should handle arrays of objects', async () => {
      const arr = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
        { id: 3, name: 'Third' },
      ]

      await storage.set('object-array', arr)

      const result = await storage.get<typeof arr>('object-array')
      expect(result).toEqual(arr)
      expect(result?.[1].name).toBe('Second')
    })

    it('should handle Date objects', async () => {
      const date = new Date('2024-01-01T00:00:00Z')

      await storage.set('date', date)

      const result = await storage.get<Date>('date')
      expect(result).toEqual(date)
    })

    it('should handle very large numbers', async () => {
      const largeNum = Number.MAX_SAFE_INTEGER

      await storage.set('large-number', largeNum)

      const result = await storage.get<number>('large-number')
      expect(result).toBe(largeNum)
    })

    it('should handle empty strings', async () => {
      await storage.set('empty-string', '')

      const result = await storage.get<string>('empty-string')
      expect(result).toBe('')
    })

    it('should handle empty arrays', async () => {
      await storage.set('empty-array', [])

      const result = await storage.get<any[]>('empty-array')
      expect(result).toEqual([])
    })

    it('should handle empty objects', async () => {
      await storage.set('empty-object', {})

      const result = await storage.get<object>('empty-object')
      expect(result).toEqual({})
    })
  })

  describe('Edge Cases', () => {
    it('should handle keys with special characters', async () => {
      await storage.set('key:with:colons', 'value')
      await storage.set('key/with/slashes', 'value')
      await storage.set('key.with.dots', 'value')

      expect(await storage.get('key:with:colons')).toBe('value')
      expect(await storage.get('key/with/slashes')).toBe('value')
      expect(await storage.get('key.with.dots')).toBe('value')
    })

    it('should handle very long keys', async () => {
      const longKey = 'k'.repeat(1000)

      await storage.set(longKey, 'value')

      const result = await storage.get<string>(longKey)
      expect(result).toBe('value')
    })

    it('should handle very long values', async () => {
      const longValue = 'v'.repeat(10000)

      await storage.set('long-value', longValue)

      const result = await storage.get<string>('long-value')
      expect(result).toBe(longValue)
    })

    it('should handle Unicode characters in keys', async () => {
      await storage.set('key-🔑-emoji', 'value')
      await storage.set('key-你好-chinese', 'value')

      expect(await storage.get('key-🔑-emoji')).toBe('value')
      expect(await storage.get('key-你好-chinese')).toBe('value')
    })

    it('should handle Unicode characters in values', async () => {
      await storage.set('unicode', '你好世界🌍')

      const result = await storage.get<string>('unicode')
      expect(result).toBe('你好世界🌍')
    })

    it('should handle many keys (scalability)', async () => {
      const keyCount = 1000

      // Store many keys
      for (let i = 0; i < keyCount; i++) {
        await storage.set(`key-${i}`, `value-${i}`)
      }

      // Verify count
      const keys = await storage.list()
      expect(keys).toHaveLength(keyCount)

      // Verify retrieval
      const result = await storage.get<string>('key-500')
      expect(result).toBe('value-500')
    })

    it('should handle rapid sequential operations', async () => {
      // Rapid set operations
      await storage.set('rapid-1', 'value-1')
      await storage.set('rapid-2', 'value-2')
      await storage.set('rapid-3', 'value-3')
      await storage.remove('rapid-1')
      await storage.set('rapid-4', 'value-4')

      const keys = await storage.list()
      expect(keys).toEqual(['rapid-2', 'rapid-3', 'rapid-4'])
    })

    it('should maintain data integrity across operations', async () => {
      // Complex sequence of operations
      await storage.set('data-1', { count: 1 })
      await storage.set('data-2', { count: 2 })
      await storage.set('data-1', { count: 10 }) // Update
      await storage.remove('data-2')
      await storage.set('data-3', { count: 3 })

      expect(await storage.get('data-1')).toEqual({ count: 10 })
      expect(await storage.get('data-2')).toBeNull()
      expect(await storage.get('data-3')).toEqual({ count: 3 })
    })
  })

  describe('Isolation', () => {
    it('should maintain separate storage instances', async () => {
      const storage1 = new MemoryStorage()
      const storage2 = new MemoryStorage()

      await storage1.set('shared-key', 'value-1')
      await storage2.set('shared-key', 'value-2')

      expect(await storage1.get('shared-key')).toBe('value-1')
      expect(await storage2.get('shared-key')).toBe('value-2')
    })

    it('should not share data between instances', async () => {
      const storage1 = new MemoryStorage()
      const storage2 = new MemoryStorage()

      await storage1.set('key-1', 'value-1')

      const result = await storage2.get('key-1')
      expect(result).toBeNull()
    })
  })

  describe('Type Safety', () => {
    it('should handle type casting correctly', async () => {
      type User = {
        id: number
        name: string
        email: string
      }

      const user: User = {
        id: 1,
        name: 'John Doe',
        email: 'john@example.com',
      }

      await storage.set<User>('user', user)

      const result = await storage.get<User>('user')
      expect(result).toEqual(user)
      expect(result?.id).toBe(1)
      expect(result?.name).toBe('John Doe')
    })

    it('should allow storing different types under different keys', async () => {
      await storage.set<string>('string-key', 'string-value')
      await storage.set<number>('number-key', 42)
      await storage.set<boolean>('boolean-key', true)
      await storage.set<object>('object-key', { test: true })

      expect(await storage.get<string>('string-key')).toBe('string-value')
      expect(await storage.get<number>('number-key')).toBe(42)
      expect(await storage.get<boolean>('boolean-key')).toBe(true)
      expect(await storage.get<object>('object-key')).toEqual({ test: true })
    })
  })
})
