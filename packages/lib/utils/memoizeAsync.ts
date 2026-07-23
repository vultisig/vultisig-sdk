type Cache<T> = {
  data: T
  updatedAt: number
}

type MemoizeAsyncOptions = {
  cacheTime?: number
}

export const memoizeAsync = <T extends (...args: any[]) => Promise<any>>(
  func: T,
  options: MemoizeAsyncOptions = {}
): T => {
  const { cacheTime } = options
  const cache = new Map<string, Cache<Awaited<ReturnType<T>>>>()
  const pendingPromises = new Map<string, Promise<Awaited<ReturnType<T>>>>()

  const memoizedFunc = async (...args: Parameters<T>) => {
    const key = JSON.stringify(args)
    const now = Date.now()

    const cachedResult = cache.get(key)
    if (cachedResult && (!cacheTime || cachedResult.updatedAt >= now - cacheTime)) {
      return cachedResult.data
    }

    const pendingPromise = pendingPromises.get(key)
    if (pendingPromise) {
      return pendingPromise
    }

    const promise = (async () => {
      try {
        const result = await func(...args)
        cache.set(key, {
          data: result,
          updatedAt: Date.now(),
        })

        return result
      } finally {
        pendingPromises.delete(key)
      }
    })()

    pendingPromises.set(key, promise)
    return promise
  }

  return memoizedFunc as T
}
