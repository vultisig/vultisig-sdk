/**
 * Cached item with TTL
 */
type CachedItem<T> = {
  value: T
  timestamp: number
}

/**
 * Service for centralized caching logic.
 * Extracted from Vault to make caching reusable and testable.
 */
export class CacheService {
  private cache = new Map<string, CachedItem<any>>()

  /**
   * Get cached item if not expired
   * @param key Cache key
   * @param ttl Time-to-live in milliseconds
   */
  get<T>(key: string, ttl: number): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    const age = Date.now() - item.timestamp
    if (age > ttl) {
      // Expired
      this.cache.delete(key)
      return null
    }

    return item.value as T
  }

  /**
   * Store item in cache
   * @param key Cache key
   * @param value Value to cache
   */
  set<T>(key: string, value: T): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    })
  }

  /**
   * Clear specific cache entry
   * @param key Cache key
   */
  clear(key: string): void {
    this.cache.delete(key)
  }

  /**
   * Clear all cache entries
   */
  clearAll(): void {
    this.cache.clear()
  }

  /**
   * Clear expired entries
   * @param ttl Time-to-live in milliseconds
   */
  clearExpired(ttl: number): void {
    const now = Date.now()
    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > ttl) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Get or compute value with caching
   * @param key Cache key
   * @param ttl Time-to-live in milliseconds
   * @param compute Function to compute value if not cached
   */
  async getOrCompute<T>(
    key: string,
    ttl: number,
    compute: () => Promise<T>
  ): Promise<T> {
    const cached = this.get<T>(key, ttl)
    if (cached !== null) return cached

    const value = await compute()
    this.set(key, value)
    return value
  }
}
