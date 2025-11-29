/**
 * Cache scope types - determines TTL and persistence behavior
 */
export enum CacheScope {
  // Persistent (infinite TTL, storage-backed)
  // These are expensive to compute but deterministic
  ADDRESS = 'address',

  // Ephemeral (TTL-based, memory only)
  // These change frequently and should not persist
  BALANCE = 'balance',
  PRICE = 'price',
}

/**
 * Cache configuration options
 * Allows SDK users to customize cache TTL values
 */
export type CacheConfig = {
  /** TTL for balance cache (default: 5 minutes) */
  balanceTTL?: number

  /** TTL for price cache (default: 5 minutes) */
  priceTTL?: number

  /** Maximum number of entries in memory cache (default: 1000) */
  maxMemoryCacheSize?: number
}

/**
 * Cached item with timestamp for TTL calculation
 */
export type CachedItem<T> = {
  value: T
  timestamp: number
}
