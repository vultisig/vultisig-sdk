/**
 * PasswordCacheService - Secure in-memory password caching
 *
 * Security Features:
 * - Passwords stored as Uint8Array for effective memory zeroing
 * - Automatic expiry with configurable TTL
 * - Process exit hooks to ensure cleanup
 * - Old password bytes zeroed when updating entries
 *
 * Why Uint8Array instead of string:
 * - Strings are immutable in JavaScript (can't be zeroed)
 * - Uint8Array is mutable (each byte can be overwritten)
 * - Provides actual memory cleanup, not just dereferencing
 */

type CacheEntry = {
  password: Uint8Array // Store as byte array for better memory control
  expiresAt: number // Unix timestamp in milliseconds
  timerId?: NodeJS.Timeout | number // For automatic cleanup
}

export type PasswordCacheConfig = {
  defaultTTL: number // milliseconds (0 = disabled)
}

// Helper functions for string <-> Uint8Array conversion
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str)
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

export class PasswordCacheService {
  private static instance: PasswordCacheService
  private cache: Map<string, CacheEntry> = new Map()
  private config: PasswordCacheConfig

  private constructor(config?: Partial<PasswordCacheConfig>) {
    this.config = {
      defaultTTL: config?.defaultTTL ?? 300000, // 5 minutes (set to 0 to disable)
    }

    // Setup cleanup on process exit (Node.js)
    if (typeof process !== 'undefined') {
      process.on('exit', () => this.clear())
      process.on('SIGINT', () => {
        this.clear()
        process.exit(0)
      })
      process.on('SIGTERM', () => {
        this.clear()
        process.exit(0)
      })
    }

    // Setup cleanup on browser unload
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.clear())
      window.addEventListener('unload', () => this.clear())
    }
  }

  public static getInstance(
    config?: Partial<PasswordCacheConfig>
  ): PasswordCacheService {
    if (!PasswordCacheService.instance) {
      PasswordCacheService.instance = new PasswordCacheService(config)
    }
    return PasswordCacheService.instance
  }

  /**
   * Reset singleton instance (for testing only)
   * @internal
   */
  public static resetInstance(): void {
    if (PasswordCacheService.instance) {
      PasswordCacheService.instance.clear()
      PasswordCacheService.instance = undefined as any
    }
  }

  /**
   * Cache a password for a vault
   * @param vaultId - Unique vault identifier
   * @param password - Password to cache (will be converted to Uint8Array)
   * @param ttl - Time to live in milliseconds (optional, uses config default)
   */
  public set(vaultId: string, password: string, ttl?: number): void {
    const effectiveTTL = ttl ?? this.config.defaultTTL

    // TTL of 0 means caching is disabled
    if (effectiveTTL === 0) {
      return
    }

    // Clear existing entry (including memory cleanup)
    const existing = this.cache.get(vaultId)
    if (existing) {
      if (existing.timerId) {
        clearTimeout(existing.timerId as any)
      }
      // Zero out old password bytes
      this.zeroMemory(existing.password)
    }

    const expiresAt = Date.now() + effectiveTTL

    // Set up automatic expiry
    const timerId = setTimeout(() => {
      this.delete(vaultId)
    }, effectiveTTL)

    // Convert string to byte array for better memory control
    this.cache.set(vaultId, {
      password: stringToBytes(password),
      expiresAt,
      timerId,
    })
  }

  /**
   * Get cached password for a vault
   * @param vaultId - Unique vault identifier
   * @returns Password if cached and not expired, undefined otherwise
   */
  public get(vaultId: string): string | undefined {
    const entry = this.cache.get(vaultId)

    if (!entry) {
      return undefined
    }

    // Check if expired
    if (Date.now() >= entry.expiresAt) {
      this.delete(vaultId)
      return undefined
    }

    // Convert byte array back to string
    return bytesToString(entry.password)
  }

  /**
   * Check if password is cached for a vault
   * @param vaultId - Unique vault identifier
   * @returns True if password is cached and not expired
   */
  public has(vaultId: string): boolean {
    return this.get(vaultId) !== undefined
  }

  /**
   * Remove password from cache
   * @param vaultId - Unique vault identifier
   */
  public delete(vaultId: string): void {
    const entry = this.cache.get(vaultId)

    if (entry) {
      // Clear timer
      if (entry.timerId) {
        clearTimeout(entry.timerId as any)
      }

      // Zero out password bytes in memory
      this.zeroMemory(entry.password)

      this.cache.delete(vaultId)
    }
  }

  /**
   * Zero out password bytes in memory (security best practice)
   * Uint8Array gives us direct memory control unlike immutable strings
   */
  private zeroMemory(passwordBytes: Uint8Array): void {
    if (!passwordBytes) return

    // Overwrite each byte with zero
    for (let i = 0; i < passwordBytes.length; i++) {
      passwordBytes[i] = 0
    }
  }

  /**
   * Clear all cached passwords
   */
  public clear(): void {
    for (const vaultId of this.cache.keys()) {
      this.delete(vaultId)
    }
    this.cache.clear()
  }

  /**
   * Get remaining TTL for a cached password
   * @param vaultId - Unique vault identifier
   * @returns Milliseconds until expiry, or undefined if not cached
   */
  public getRemainingTTL(vaultId: string): number | undefined {
    const entry = this.cache.get(vaultId)

    if (!entry) {
      return undefined
    }

    const remaining = entry.expiresAt - Date.now()
    return remaining > 0 ? remaining : undefined
  }

  /**
   * Update config (useful for testing or runtime changes)
   */
  public updateConfig(config: Partial<PasswordCacheConfig>): void {
    this.config = { ...this.config, ...config }

    // If TTL set to 0 (disabled), clear all passwords
    if (this.config.defaultTTL === 0) {
      this.clear()
    }
  }

  /**
   * Get cache statistics (useful for debugging)
   */
  public getStats(): { total: number; expired: number } {
    const now = Date.now()
    let expired = 0

    for (const entry of this.cache.values()) {
      if (now >= entry.expiresAt) {
        expired++
      }
    }

    return {
      total: this.cache.size,
      expired,
    }
  }
}
