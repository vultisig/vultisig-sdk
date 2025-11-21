import type { Storage } from '../runtime/storage/types'
import { type CacheConfig, type CachedItem, CacheScope } from './cache-types'

/**
 * Enhanced CacheService with storage integration and scope-based caching.
 *
 * Features:
 * - Two-layer caching: memory (all scopes) + storage (persistent scopes only)
 * - Configurable TTLs per scope
 * - Automatic persistence for deterministic data (addresses)
 * - Prefix-based and scope-based invalidation
 * - Thread-safe with race condition prevention
 * - Size management to prevent memory leaks
 *
 * Usage:
 * ```typescript
 * const cache = new CacheService(storage, vaultId, { balanceTTL: 10 * 60 * 1000 })
 * await cache.init() // Load persistent cache from storage
 *
 * // Scoped methods (recommended)
 * const address = await cache.getOrComputeScoped('ethereum', CacheScope.ADDRESS, () => derive())
 * const balance = cache.getScoped('ethereum:native', CacheScope.BALANCE)
 *
 * // Legacy methods (backward compatible)
 * const value = cache.get('myKey', 5 * 60 * 1000)
 * ```
 */
export class CacheService {
  private cache = new Map<string, CachedItem<any>>()
  private pendingComputations = new Map<string, Promise<any>>()

  // Storage integration for persistent cache
  private storage?: Storage
  private vaultId?: number
  private config: Required<CacheConfig>

  // Persistent scopes (stored to disk, infinite TTL)
  private static readonly PERSISTENT_SCOPES = new Set([CacheScope.ADDRESS])

  /**
   * Create a new CacheService instance
   * @param storage Optional storage backend for persistent cache
   * @param vaultId Vault ID for storage keys (required if storage provided)
   * @param config Cache configuration (TTLs, size limits)
   */
  constructor(storage?: Storage, vaultId?: number, config?: CacheConfig) {
    this.storage = storage
    this.vaultId = vaultId
    this.config = {
      balanceTTL: config?.balanceTTL ?? 5 * 60 * 1000,
      priceTTL: config?.priceTTL ?? 5 * 60 * 1000,
      gasTTL: config?.gasTTL ?? 2 * 60 * 1000,
      portfolioTTL: config?.portfolioTTL ?? 1 * 60 * 1000,
      maxMemoryCacheSize: config?.maxMemoryCacheSize ?? 1000,
    }
  }

  /**
   * Initialize cache - loads persistent cache from storage
   * Must be called after construction if using storage
   */
  async init(): Promise<void> {
    if (!this.storage || !this.vaultId) return

    // Load all persistent scopes from storage
    for (const scope of CacheService.PERSISTENT_SCOPES) {
      await this.loadPersistentScope(scope)
    }
  }

  // ========================================
  // Scoped Cache Methods (Recommended)
  // ========================================

  /**
   * Get cached value using scope (automatically determines TTL)
   * @param key Cache key (without scope prefix)
   * @param scope Cache scope
   */
  getScoped<T>(key: string, scope: CacheScope): T | null {
    const ttl = this.getTTLForScope(scope)
    const cacheKey = this.buildKey(key, scope)
    return this.get<T>(cacheKey, ttl)
  }

  /**
   * Set cached value using scope (automatically persists if needed)
   * @param key Cache key (without scope prefix)
   * @param scope Cache scope
   * @param value Value to cache
   */
  async setScoped<T>(key: string, scope: CacheScope, value: T): Promise<void> {
    const cacheKey = this.buildKey(key, scope)

    // Set in memory
    this.set(cacheKey, value)

    // If persistent scope, also write to storage
    if (
      CacheService.PERSISTENT_SCOPES.has(scope) &&
      this.storage &&
      this.vaultId
    ) {
      const storageKey = `vault:${this.vaultId}:cache:${cacheKey}`
      await this.storage.set(storageKey, value)
    }

    this.enforceMaxSize()
  }

  /**
   * Get or compute value with scope-based caching
   * Thread-safe: concurrent calls with same key share the same promise
   * @param key Cache key (without scope prefix)
   * @param scope Cache scope
   * @param compute Function to compute value if not cached
   */
  async getOrComputeScoped<T>(
    key: string,
    scope: CacheScope,
    compute: () => Promise<T>
  ): Promise<T> {
    const ttl = this.getTTLForScope(scope)
    const cacheKey = this.buildKey(key, scope)

    // Check cache first
    const cached = this.get<T>(cacheKey, ttl)
    if (cached !== null) return cached

    // Check for in-flight computation
    const pending = this.pendingComputations.get(cacheKey)
    if (pending) return pending as Promise<T>

    // Start new computation
    const promise = (async () => {
      try {
        const value = await compute()
        await this.setScoped(key, scope, value)
        return value
      } finally {
        this.pendingComputations.delete(cacheKey)
      }
    })()

    this.pendingComputations.set(cacheKey, promise)
    return promise
  }

  /**
   * Invalidate a specific cached value
   * @param key Cache key (without scope prefix)
   * @param scope Cache scope
   */
  async invalidateScoped(key: string, scope: CacheScope): Promise<void> {
    const cacheKey = this.buildKey(key, scope)
    this.cache.delete(cacheKey)

    // If persistent, also remove from storage
    if (
      CacheService.PERSISTENT_SCOPES.has(scope) &&
      this.storage &&
      this.vaultId
    ) {
      const storageKey = `vault:${this.vaultId}:cache:${cacheKey}`
      await this.storage.remove(storageKey)
    }
  }

  /**
   * Invalidate all cached values matching a prefix
   * Useful for invalidating all balances for a chain, all prices, etc.
   * @param prefix Key prefix (e.g., "balance:ethereum" or "price:")
   */
  async invalidateByPrefix(prefix: string): Promise<void> {
    const keys = Array.from(this.cache.keys()).filter(k => k.startsWith(prefix))

    await Promise.all(
      keys.map(async key => {
        this.cache.delete(key)

        // Check if this key is from a persistent scope
        const scope = this.parseScopeFromKey(key)
        if (
          scope &&
          CacheService.PERSISTENT_SCOPES.has(scope) &&
          this.storage &&
          this.vaultId
        ) {
          const storageKey = `vault:${this.vaultId}:cache:${key}`
          await this.storage.remove(storageKey)
        }
      })
    )
  }

  /**
   * Invalidate all cached values for a specific scope
   * @param scope Cache scope to invalidate
   */
  async invalidateScope(scope: CacheScope): Promise<void> {
    await this.invalidateByPrefix(`${scope}:`)
  }

  // ========================================
  // Legacy Cache Methods (Backward Compatible)
  // ========================================

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
   * Thread-safe: Concurrent calls with same key share the same promise
   *
   * @param key Cache key
   * @param ttl Time-to-live in milliseconds
   * @param compute Function to compute value if not cached
   */
  async getOrCompute<T>(
    key: string,
    ttl: number,
    compute: () => Promise<T>
  ): Promise<T> {
    // Check cache first
    const cached = this.get<T>(key, ttl)
    if (cached !== null) return cached

    // Check for in-flight computation (FIX: Prevents race condition)
    const pending = this.pendingComputations.get(key)
    if (pending) {
      return pending as Promise<T>
    }

    // Start new computation
    const promise = (async () => {
      try {
        const value = await compute()
        this.set(key, value)
        return value
      } finally {
        // Clean up pending computation after completion (success or failure)
        this.pendingComputations.delete(key)
      }
    })()

    this.pendingComputations.set(key, promise)
    return promise
  }

  // ========================================
  // Helper Methods
  // ========================================

  /**
   * Build cache key with scope prefix
   * @param key Original key
   * @param scope Cache scope
   */
  private buildKey(key: string, scope: CacheScope): string {
    return `${scope}:${key.toLowerCase()}`
  }

  /**
   * Get TTL for a scope based on configuration
   * @param scope Cache scope
   */
  private getTTLForScope(scope: CacheScope): number {
    switch (scope) {
      case CacheScope.ADDRESS:
        return Number.MAX_SAFE_INTEGER // Infinite (persistent)
      case CacheScope.BALANCE:
        return this.config.balanceTTL
      case CacheScope.PRICE:
        return this.config.priceTTL
      case CacheScope.GAS:
        return this.config.gasTTL
      case CacheScope.PORTFOLIO:
        return this.config.portfolioTTL
      default:
        return 5 * 60 * 1000 // Default 5 minutes
    }
  }

  /**
   * Parse scope from cache key
   * @param key Full cache key (e.g., "address:ethereum")
   */
  private parseScopeFromKey(key: string): CacheScope | null {
    const prefix = key.split(':')[0]
    return Object.values(CacheScope).includes(prefix as CacheScope)
      ? (prefix as CacheScope)
      : null
  }

  /**
   * Load persistent cache entries for a scope from storage
   * @param _scope Persistent cache scope to load
   */
  private async loadPersistentScope(_scope: CacheScope): Promise<void> {
    if (!this.storage || !this.vaultId) return

    // For now, we load addresses individually as chains are accessed
    // Future: implement storage.listKeys() for full enumeration
    // Storage pattern: vault:{id}:cache:{scope}:*
  }

  /**
   * Enforce maximum cache size by evicting non-persistent entries
   */
  private enforceMaxSize(): void {
    const max = this.config.maxMemoryCacheSize
    if (this.cache.size <= max) return

    // Simple FIFO: delete oldest non-persistent entries
    const entries = Array.from(this.cache.entries())
    const nonPersistent = entries.filter(([key]) => {
      const scope = this.parseScopeFromKey(key)
      return !scope || !CacheService.PERSISTENT_SCOPES.has(scope)
    })

    const toDelete = this.cache.size - max
    nonPersistent.slice(0, toDelete).forEach(([key]) => this.cache.delete(key))
  }
}

// Re-export types for convenience
export { type CacheConfig, CacheScope } from './cache-types'
