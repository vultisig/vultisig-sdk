import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CacheService } from '../../../src/services/CacheService'

describe('CacheService', () => {
  let cache: CacheService

  beforeEach(() => {
    cache = new CacheService()
    vi.clearAllMocks()
  })

  describe('basic caching', () => {
    it('should store and retrieve values', () => {
      cache.set('key1', 'value1')
      const result = cache.get('key1', 1000)

      expect(result).toBe('value1')
    })

    it('should return null for missing keys', () => {
      const result = cache.get('nonexistent', 1000)
      expect(result).toBeNull()
    })

    it('should cache different types', () => {
      cache.set('string', 'text')
      cache.set('number', 42)
      cache.set('object', { id: 1, name: 'test' })
      cache.set('array', [1, 2, 3])

      expect(cache.get('string', 1000)).toBe('text')
      expect(cache.get('number', 1000)).toBe(42)
      expect(cache.get('object', 1000)).toEqual({ id: 1, name: 'test' })
      expect(cache.get('array', 1000)).toEqual([1, 2, 3])
    })
  })

  describe('TTL (time-to-live)', () => {
    it('should respect TTL and expire old entries', async () => {
      cache.set('key1', 'value1')

      // Should exist immediately
      expect(cache.get('key1', 100)).toBe('value1')

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should be null after expiration
      expect(cache.get('key1', 100)).toBeNull()
    })

    it('should not expire entries within TTL', async () => {
      cache.set('key1', 'value1')

      // Wait less than TTL
      await new Promise(resolve => setTimeout(resolve, 50))

      // Should still exist
      expect(cache.get('key1', 100)).toBe('value1')
    })

    it('should handle different TTLs for different keys', async () => {
      cache.set('short', 'value1')
      cache.set('long', 'value2')

      await new Promise(resolve => setTimeout(resolve, 60))

      // Short TTL should expire
      expect(cache.get('short', 50)).toBeNull()
      // Long TTL should still exist
      expect(cache.get('long', 100)).toBe('value2')
    })
  })

  describe('cache clearing', () => {
    it('should clear specific entry', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')

      cache.clear('key1')

      expect(cache.get('key1', 1000)).toBeNull()
      expect(cache.get('key2', 1000)).toBe('value2')
    })

    it('should clear all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3')

      cache.clearAll()

      expect(cache.get('key1', 1000)).toBeNull()
      expect(cache.get('key2', 1000)).toBeNull()
      expect(cache.get('key3', 1000)).toBeNull()
    })

    it('should clear expired entries', async () => {
      cache.set('old1', 'value1')
      cache.set('old2', 'value2')

      await new Promise(resolve => setTimeout(resolve, 60))

      cache.set('new', 'value3')

      cache.clearExpired(50)

      // Old entries should be cleared
      expect(cache.get('old1', 1000)).toBeNull()
      expect(cache.get('old2', 1000)).toBeNull()
      // New entry should remain
      expect(cache.get('new', 1000)).toBe('value3')
    })
  })

  describe('getOrCompute', () => {
    it('should compute and cache value when not cached', async () => {
      let computeCount = 0
      const compute = async () => {
        computeCount++
        return 'computed-value'
      }

      const result = await cache.getOrCompute('key1', 1000, compute)

      expect(result).toBe('computed-value')
      expect(computeCount).toBe(1)

      // Should use cache on second call
      const result2 = await cache.getOrCompute('key1', 1000, compute)
      expect(result2).toBe('computed-value')
      expect(computeCount).toBe(1) // Still 1, not 2
    })

    it('should use cached value when available', async () => {
      cache.set('key1', 'cached-value')

      let computeCalled = false
      const compute = async () => {
        computeCalled = true
        return 'computed-value'
      }

      const result = await cache.getOrCompute('key1', 1000, compute)

      expect(result).toBe('cached-value')
      expect(computeCalled).toBe(false)
    })

    it('should recompute after cache expiry', async () => {
      let computeCount = 0
      const compute = async () => {
        computeCount++
        return `computed-${computeCount}`
      }

      // First call
      const result1 = await cache.getOrCompute('key1', 50, compute)
      expect(result1).toBe('computed-1')
      expect(computeCount).toBe(1)

      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 100))

      // Second call should recompute
      const result2 = await cache.getOrCompute('key1', 50, compute)
      expect(result2).toBe('computed-2')
      expect(computeCount).toBe(2)
    })

    it('should handle different keys independently', async () => {
      let callCount = 0
      const compute = async (suffix: string) => {
        callCount++
        return `value-${suffix}`
      }

      const result1 = await cache.getOrCompute('key1', 1000, () =>
        compute('first')
      )
      const result2 = await cache.getOrCompute('key2', 1000, () =>
        compute('second')
      )
      const result3 = await cache.getOrCompute('key1', 1000, () =>
        compute('third')
      )

      expect(result1).toBe('value-first')
      expect(result2).toBe('value-second')
      expect(result3).toBe('value-first') // Uses cache
      expect(callCount).toBe(2) // Only computed for key1 and key2
    })
  })

  describe('concurrent operations (race condition fix)', () => {
    it('should only compute once for concurrent calls with same key', async () => {
      let computeCount = 0
      const compute = async () => {
        computeCount++
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 100))
        return `result-${computeCount}`
      }

      // Call 10 times concurrently with same key
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => cache.getOrCompute('concurrent-key', 1000, compute))
      )

      // All results should be identical
      expect(results).toEqual(Array(10).fill('result-1'))
      // BUG FIX: Should only compute ONCE, not 10 times
      expect(computeCount).toBe(1)
    })

    it('should handle concurrent calls with different keys', async () => {
      let computeCount = 0
      const compute = async (key: string) => {
        computeCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return `result-${key}`
      }

      // Call with 3 different keys, 3 times each, all concurrently
      const results = await Promise.all([
        cache.getOrCompute('key1', 1000, () => compute('key1')),
        cache.getOrCompute('key1', 1000, () => compute('key1')),
        cache.getOrCompute('key1', 1000, () => compute('key1')),
        cache.getOrCompute('key2', 1000, () => compute('key2')),
        cache.getOrCompute('key2', 1000, () => compute('key2')),
        cache.getOrCompute('key2', 1000, () => compute('key2')),
        cache.getOrCompute('key3', 1000, () => compute('key3')),
        cache.getOrCompute('key3', 1000, () => compute('key3')),
        cache.getOrCompute('key3', 1000, () => compute('key3')),
      ])

      expect(results).toEqual([
        'result-key1',
        'result-key1',
        'result-key1',
        'result-key2',
        'result-key2',
        'result-key2',
        'result-key3',
        'result-key3',
        'result-key3',
      ])
      // Should only compute 3 times (once per unique key)
      expect(computeCount).toBe(3)
    })

    it('should properly clean up pending computations after completion', async () => {
      let computeCount = 0
      const compute = async () => {
        computeCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return `result-${computeCount}`
      }

      // First batch of concurrent calls
      await Promise.all([
        cache.getOrCompute('test-key', 1000, compute),
        cache.getOrCompute('test-key', 1000, compute),
        cache.getOrCompute('test-key', 1000, compute),
      ])

      expect(computeCount).toBe(1)

      // Second batch should use cached result, not pending promise
      await Promise.all([
        cache.getOrCompute('test-key', 1000, compute),
        cache.getOrCompute('test-key', 1000, compute),
        cache.getOrCompute('test-key', 1000, compute),
      ])

      // Should still be 1 - uses cached result
      expect(computeCount).toBe(1)
    })

    it('should handle concurrent calls that arrive during computation', async () => {
      let computeCount = 0
      const compute = async () => {
        computeCount++
        await new Promise(resolve => setTimeout(resolve, 100))
        return `result-${computeCount}`
      }

      // Start first call
      const promise1 = cache.getOrCompute('staggered-key', 1000, compute)

      // Wait a bit, then start more calls while first is still computing
      await new Promise(resolve => setTimeout(resolve, 30))
      const promise2 = cache.getOrCompute('staggered-key', 1000, compute)
      const promise3 = cache.getOrCompute('staggered-key', 1000, compute)

      const results = await Promise.all([promise1, promise2, promise3])

      expect(results).toEqual(['result-1', 'result-1', 'result-1'])
      expect(computeCount).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should not cache errors', async () => {
      let attempts = 0
      const flakyCompute = async () => {
        attempts++
        if (attempts === 1) {
          throw new Error('Computation failed')
        }
        return 'success'
      }

      // First call should fail
      await expect(
        cache.getOrCompute('error-key', 1000, flakyCompute)
      ).rejects.toThrow('Computation failed')

      // Second call should succeed (error was not cached)
      const result = await cache.getOrCompute('error-key', 1000, flakyCompute)
      expect(result).toBe('success')
      expect(attempts).toBe(2)
    })

    it('should clean up pending computation on error', async () => {
      let attempts = 0
      const flakyCompute = async () => {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 50))
        if (attempts === 1) {
          throw new Error('Failure')
        }
        return 'success'
      }

      // Multiple concurrent calls, all should fail
      const promises = Promise.all([
        cache
          .getOrCompute('error-concurrent', 1000, flakyCompute)
          .catch(e => e.message),
        cache
          .getOrCompute('error-concurrent', 1000, flakyCompute)
          .catch(e => e.message),
        cache
          .getOrCompute('error-concurrent', 1000, flakyCompute)
          .catch(e => e.message),
      ])

      const results = await promises
      expect(results).toEqual(['Failure', 'Failure', 'Failure'])
      expect(attempts).toBe(1) // Only called once (shared promise)

      // Retry should work (pending promise was cleaned up)
      const retryResult = await cache.getOrCompute(
        'error-concurrent',
        1000,
        flakyCompute
      )
      expect(retryResult).toBe('success')
      expect(attempts).toBe(2)
    })

    it('should propagate errors to all concurrent callers', async () => {
      const failingCompute = async () => {
        await new Promise(resolve => setTimeout(resolve, 50))
        throw new Error('Always fails')
      }

      const promises = [
        cache
          .getOrCompute('fail-key', 1000, failingCompute)
          .catch(e => e.message),
        cache
          .getOrCompute('fail-key', 1000, failingCompute)
          .catch(e => e.message),
        cache
          .getOrCompute('fail-key', 1000, failingCompute)
          .catch(e => e.message),
      ]

      const results = await Promise.all(promises)
      expect(results).toEqual(['Always fails', 'Always fails', 'Always fails'])
    })
  })

  describe('edge cases', () => {
    it('should handle null values', () => {
      cache.set('null-key', null)
      const result = cache.get('null-key', 1000)
      expect(result).toBe(null)
    })

    it('should handle undefined values', () => {
      cache.set('undefined-key', undefined)
      const result = cache.get('undefined-key', 1000)
      expect(result).toBe(undefined)
    })

    it('should handle zero TTL', async () => {
      cache.set('zero-ttl', 'value')
      // With TTL of 0, any age > 0 will expire it
      // Wait a tiny bit to ensure age > 0
      await new Promise(resolve => setTimeout(resolve, 10))
      const result = cache.get('zero-ttl', 0)
      expect(result).toBeNull()
    })

    it('should handle very large TTL', () => {
      cache.set('large-ttl', 'value')
      const result = cache.get('large-ttl', Number.MAX_SAFE_INTEGER)
      expect(result).toBe('value')
    })

    it('should handle special characters in keys', async () => {
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key.with.dots',
        'key-with-dashes',
        'key_with_underscores',
        'key with spaces',
      ]

      for (const key of specialKeys) {
        cache.set(key, `value-${key}`)
        const result = cache.get(key, 1000)
        expect(result).toBe(`value-${key}`)
      }
    })

    it('should handle rapid sequential calls', async () => {
      let callCount = 0
      const compute = async () => {
        callCount++
        return `result-${callCount}`
      }

      // Call sequentially (not concurrently)
      const result1 = await cache.getOrCompute('seq-key', 1000, compute)
      const result2 = await cache.getOrCompute('seq-key', 1000, compute)
      const result3 = await cache.getOrCompute('seq-key', 1000, compute)

      expect(result1).toBe('result-1')
      expect(result2).toBe('result-1') // Uses cache
      expect(result3).toBe('result-1') // Uses cache
      expect(callCount).toBe(1)
    })
  })
})
