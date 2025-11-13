import { beforeEach, describe, expect, it, vi } from 'vitest'

import { memoizeAsync } from '../../../src/utils/memoizeAsync'

describe('memoizeAsync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('basic functionality', () => {
    it('should memoize function results', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        return `result-${arg}`
      }

      const memoized = memoizeAsync(expensiveFn)

      const result1 = await memoized('test')
      const result2 = await memoized('test')

      expect(result1).toBe('result-test')
      expect(result2).toBe('result-test')
      expect(callCount).toBe(1) // Should only call once
    })

    it('should cache different arguments separately', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        return `result-${arg}`
      }

      const memoized = memoizeAsync(expensiveFn)

      const result1 = await memoized('arg1')
      const result2 = await memoized('arg2')
      const result3 = await memoized('arg1') // Should use cache

      expect(result1).toBe('result-arg1')
      expect(result2).toBe('result-arg2')
      expect(result3).toBe('result-arg1')
      expect(callCount).toBe(2) // Called for arg1 and arg2, not for second arg1
    })

    it('should handle multiple arguments', async () => {
      let callCount = 0
      const expensiveFn = async (a: string, b: number) => {
        callCount++
        return `${a}-${b}`
      }

      const memoized = memoizeAsync(expensiveFn)

      const result1 = await memoized('test', 42)
      const result2 = await memoized('test', 42)
      const result3 = await memoized('test', 99)

      expect(result1).toBe('test-42')
      expect(result2).toBe('test-42')
      expect(result3).toBe('test-99')
      expect(callCount).toBe(2) // Once for (test, 42), once for (test, 99)
    })
  })

  describe('concurrent calls (race condition fix)', () => {
    it('should only call function once for concurrent calls with same arguments', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 100))
        return `result-${arg}`
      }

      const memoized = memoizeAsync(expensiveFn)

      // Call 10 times concurrently with same arg
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => memoized('test'))
      )

      // All results should be identical
      expect(results).toEqual(Array(10).fill('result-test'))
      // BUG FIX: Should only call function ONCE, not 10 times
      expect(callCount).toBe(1)
    })

    it('should handle concurrent calls with different arguments', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return `result-${arg}`
      }

      const memoized = memoizeAsync(expensiveFn)

      // Call with 3 different args, 3 times each, all concurrently
      const results = await Promise.all([
        memoized('arg1'),
        memoized('arg1'),
        memoized('arg1'),
        memoized('arg2'),
        memoized('arg2'),
        memoized('arg2'),
        memoized('arg3'),
        memoized('arg3'),
        memoized('arg3'),
      ])

      expect(results).toEqual([
        'result-arg1',
        'result-arg1',
        'result-arg1',
        'result-arg2',
        'result-arg2',
        'result-arg2',
        'result-arg3',
        'result-arg3',
        'result-arg3',
      ])
      // Should only call 3 times (once per unique argument)
      expect(callCount).toBe(3)
    })

    it('should properly clean up pending promises after completion', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return `result-${arg}`
      }

      const memoized = memoizeAsync(expensiveFn)

      // First batch of concurrent calls
      await Promise.all([memoized('test'), memoized('test'), memoized('test')])

      expect(callCount).toBe(1)

      // Second batch of concurrent calls (should use cached result, not pending promise)
      await Promise.all([memoized('test'), memoized('test'), memoized('test')])

      // Should still be 1 - uses cached result
      expect(callCount).toBe(1)
    })
  })

  describe('error handling', () => {
    it('should not cache errors', async () => {
      let attempts = 0
      const flakyFn = async (arg: string) => {
        attempts++
        if (attempts === 1) {
          throw new Error('First attempt failed')
        }
        return `result-${arg}`
      }

      const memoized = memoizeAsync(flakyFn)

      // First call should fail
      await expect(memoized('test')).rejects.toThrow('First attempt failed')

      // Second call should succeed (error was not cached)
      const result = await memoized('test')
      expect(result).toBe('result-test')
      expect(attempts).toBe(2)
    })

    it('should clean up pending promise on error', async () => {
      let attempts = 0
      const flakyFn = async (arg: string) => {
        attempts++
        await new Promise(resolve => setTimeout(resolve, 50))
        if (attempts === 1) {
          throw new Error('Failure')
        }
        return `result-${arg}`
      }

      const memoized = memoizeAsync(flakyFn)

      // Multiple concurrent calls, all should fail
      const promises = Promise.all([
        memoized('test').catch(e => e.message),
        memoized('test').catch(e => e.message),
        memoized('test').catch(e => e.message),
      ])

      const results = await promises
      expect(results).toEqual(['Failure', 'Failure', 'Failure'])
      expect(attempts).toBe(1) // Only called once (shared promise)

      // Retry should work (pending promise was cleaned up)
      const retryResult = await memoized('test')
      expect(retryResult).toBe('result-test')
      expect(attempts).toBe(2)
    })
  })

  describe('cache TTL', () => {
    it('should respect cacheTime option', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        return `result-${arg}-${callCount}`
      }

      const memoized = memoizeAsync(expensiveFn, { cacheTime: 100 })

      const result1 = await memoized('test')
      expect(result1).toBe('result-test-1')
      expect(callCount).toBe(1)

      // Immediate call should use cache
      const result2 = await memoized('test')
      expect(result2).toBe('result-test-1')
      expect(callCount).toBe(1)

      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should call again after TTL
      const result3 = await memoized('test')
      expect(result3).toBe('result-test-2')
      expect(callCount).toBe(2)
    })

    it('should cache indefinitely when cacheTime is not set', async () => {
      let callCount = 0
      const expensiveFn = async (arg: string) => {
        callCount++
        return `result-${arg}-${callCount}`
      }

      const memoized = memoizeAsync(expensiveFn) // No cacheTime

      const result1 = await memoized('test')
      expect(result1).toBe('result-test-1')

      // Wait a long time
      await new Promise(resolve => setTimeout(resolve, 200))

      // Should still use cache
      const result2 = await memoized('test')
      expect(result2).toBe('result-test-1')
      expect(callCount).toBe(1)
    })
  })

  describe('edge cases', () => {
    it('should handle no-argument functions', async () => {
      let callCount = 0
      const noArgFn = async () => {
        callCount++
        return 'constant-result'
      }

      const memoized = memoizeAsync(noArgFn)

      const result1 = await memoized()
      const result2 = await memoized()

      expect(result1).toBe('constant-result')
      expect(result2).toBe('constant-result')
      expect(callCount).toBe(1)
    })

    it('should handle object arguments', async () => {
      let callCount = 0
      const objFn = async (obj: { id: number; name: string }) => {
        callCount++
        return `${obj.id}-${obj.name}`
      }

      const memoized = memoizeAsync(objFn)

      const result1 = await memoized({ id: 1, name: 'test' })
      const result2 = await memoized({ id: 1, name: 'test' })
      const result3 = await memoized({ id: 2, name: 'test' })

      expect(result1).toBe('1-test')
      expect(result2).toBe('1-test')
      expect(result3).toBe('2-test')
      expect(callCount).toBe(2)
    })

    it('should handle undefined and null arguments', async () => {
      let callCount = 0
      const nullableFn = async (arg?: string | null) => {
        callCount++
        return `result-${arg}`
      }

      const memoized = memoizeAsync(nullableFn)

      await memoized(undefined)
      await memoized(undefined)
      await memoized(null)
      await memoized(null)
      await memoized('value')
      await memoized('value')

      // Note: JSON.stringify([undefined]) === "[null]", so undefined and null
      // are treated as the same cache key
      expect(callCount).toBe(2) // Once for undefined/null, once for 'value'
    })
  })
})
