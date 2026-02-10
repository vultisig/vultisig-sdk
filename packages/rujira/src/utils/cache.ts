/**
 * Quote caching utility for reducing RPC calls
 * @module utils/cache
 */

/**
 * Cached item with TTL
 */
export type CachedItem<T> = {
  value: T
  expiresAt: number
}

/**
 * Options for QuoteCache
 */
export type QuoteCacheOptions = {
  /** Time-to-live in milliseconds (default: 10000 = 10 seconds) */
  ttlMs?: number
  /** Maximum cache size (default: 100) */
  maxSize?: number
}

/**
 * Simple TTL cache for swap quotes
 *
 * @example
 * ```typescript
 * const cache = new QuoteCache({ ttlMs: 10000 });
 *
 * // Store a quote
 * cache.set('BTC.BTC', 'THOR.RUNE', '100000000', quote);
 *
 * // Retrieve if not expired
 * const cached = cache.get('BTC.BTC', 'THOR.RUNE', '100000000');
 * if (cached) {
 *   return cached; // Cache hit
 * }
 * ```
 */
export class QuoteCache<T = unknown> {
  private cache = new Map<string, CachedItem<T>>()
  private readonly ttlMs: number
  private readonly maxSize: number

  constructor(options: QuoteCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10000 // 10 seconds default
    this.maxSize = options.maxSize ?? 100
  }

  /**
   * Generate cache key from quote parameters.
   * Slippage is intentionally excluded - callers should compute
   * slippage-dependent values (like minimumOutput) at retrieval time
   * from the cached expectedOutput, not at storage time.
   */
  private makeKey(fromAsset: string, toAsset: string, amount: string): string {
    return `${fromAsset}/${toAsset}/${amount}`
  }

  /**
   * Get cached value if not expired
   */
  get(fromAsset: string, toAsset: string, amount: string): T | null {
    const key = this.makeKey(fromAsset, toAsset, amount)
    const cached = this.cache.get(key)

    if (!cached) {
      return null
    }

    // Check expiry
    if (Date.now() > cached.expiresAt) {
      this.cache.delete(key)
      return null
    }

    return cached.value
  }

  /**
   * Store value in cache
   */
  set(fromAsset: string, toAsset: string, amount: string, value: T): void {
    const key = this.makeKey(fromAsset, toAsset, amount)

    // Enforce max size (LRU-style: remove oldest entries)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    })
  }

  /**
   * Check if cache has valid (non-expired) entry
   */
  has(fromAsset: string, toAsset: string, amount: string): boolean {
    return this.get(fromAsset, toAsset, amount) !== null
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(fromAsset: string, toAsset: string, amount: string): void {
    const key = this.makeKey(fromAsset, toAsset, amount)
    this.cache.delete(key)
  }

  /**
   * Invalidate all entries for a trading pair
   */
  invalidatePair(fromAsset: string, toAsset: string): void {
    const prefix = `${fromAsset}/${toAsset}/`
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key)
      }
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  stats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    }
  }

  /**
   * Prune expired entries (call periodically for long-running processes)
   */
  prune(): number {
    const now = Date.now()
    let pruned = 0

    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key)
        pruned++
      }
    }

    return pruned
  }
}
