/**
 * Thread-safe async memoization utility with race condition fix
 *
 * This is a fixed version of the upstream @lib/utils/memoizeAsync
 * that properly handles concurrent calls to prevent duplicate executions.
 *
 * Key Improvements:
 * - Caches in-flight promises to prevent duplicate concurrent executions
 * - Properly handles errors by cleaning up pending promises
 * - Thread-safe for concurrent calls with identical arguments
 */

type Cache<T> = {
  data: T
  updatedAt: number
}

type MemoizeAsyncOptions = {
  cacheTime?: number
}

/**
 * Memoize an async function with proper race condition handling
 *
 * @param func - The async function to memoize
 * @param options - Configuration options
 * @param options.cacheTime - Cache TTL in milliseconds (undefined = no TTL)
 * @returns Memoized version of the function
 *
 * @example
 * const fetchUser = async (id: string) => { ... }
 * const memoizedFetch = memoizeAsync(fetchUser, { cacheTime: 60000 })
 *
 * // Multiple concurrent calls with same ID share the same promise
 * await Promise.all([
 *   memoizedFetch('123'),  // Executes function
 *   memoizedFetch('123'),  // Waits for same promise
 *   memoizedFetch('123'),  // Waits for same promise
 * ])
 */
export const memoizeAsync = <T extends (...args: any[]) => Promise<any>>(
  func: T,
  options: MemoizeAsyncOptions = {}
): T => {
  const { cacheTime } = options
  const cache = new Map<string, Cache<ReturnType<T>>>()
  const pendingPromises = new Map<string, Promise<any>>()

  const memoizedFunc = async (...args: Parameters<T>) => {
    const key = JSON.stringify(args)

    // Check for cached result
    const cachedResult = cache.get(key)
    if (
      cachedResult &&
      (!cacheTime || cachedResult.updatedAt >= Date.now() - cacheTime)
    ) {
      return cachedResult.data
    }

    // Check for in-flight request (FIX: Prevents race condition)
    const pending = pendingPromises.get(key)
    if (pending) {
      return pending
    }

    // Start new request
    const promise = (async () => {
      try {
        const result = await func(...args)
        cache.set(key, {
          data: result,
          updatedAt: Date.now(),
        })
        return result
      } finally {
        // Clean up pending promise after completion (success or failure)
        pendingPromises.delete(key)
      }
    })()

    pendingPromises.set(key, promise)
    return promise
  }

  return memoizedFunc as T
}
