import type { StorageOptions } from './registry'
import { StorageManager } from './StorageManager'
import type { Storage } from './types'

/**
 * Global storage singleton.
 *
 * Provides a single configured storage instance for the entire application.
 * Classes can access storage without constructor parameter drilling.
 *
 * Usage:
 * ```typescript
 * // At app initialization (once):
 * GlobalStorage.configure({ type: 'node', basePath: '/my/vault/path' })
 *
 * // In any class:
 * const storage = GlobalStorage.getInstance()
 * const value = await storage.get('key')
 * ```
 *
 * Falls back to auto-detected default storage if not configured.
 */
export class GlobalStorage {
  private static instance: Storage | undefined

  /**
   * Configure global storage instance.
   * Should be called once at application initialization.
   *
   * @param options - Storage configuration options
   *
   * @example
   * ```typescript
   * // Use auto-detected storage
   * GlobalStorage.configure()
   *
   * // Use Node.js file storage
   * GlobalStorage.configure({ type: 'node', basePath: '/custom/path' })
   *
   * // Use browser storage
   * GlobalStorage.configure({ type: 'browser' })
   *
   * // Use custom storage
   * GlobalStorage.configure({ customStorage: myStorage })
   * ```
   */
  static configure(options?: StorageOptions): void {
    GlobalStorage.instance = StorageManager.createStorage(options)
  }

  /**
   * Get the configured storage instance.
   * Falls back to auto-detected default storage if not configured.
   *
   * @returns Storage instance
   */
  static getInstance(): Storage {
    if (!GlobalStorage.instance) {
      // Lazy initialization with default storage
      GlobalStorage.instance = StorageManager.createDefaultStorage()
    }
    return GlobalStorage.instance
  }

  /**
   * Check if storage has been explicitly configured.
   *
   * @returns true if configure() was called, false if using default
   */
  static isConfigured(): boolean {
    return GlobalStorage.instance !== undefined
  }

  /**
   * Reset storage instance (useful for testing).
   *
   * @internal
   */
  static reset(): void {
    GlobalStorage.instance = undefined
  }
}
