// Import all providers to ensure registration
// Tree-shaking will remove unused ones from final bundle
import './BrowserStorage'
import './ChromeStorage'
import './NodeStorage'
import './MemoryStorage'

import { detectEnvironment, type Environment } from '../environment'
import { storageRegistry } from './registry'
import type { Storage } from './types'

export type { StorageOptions } from './registry'

/**
 * StorageManager handles the creation and configuration of storage instances.
 *
 * Uses Provider Registry Pattern - providers self-register based on capabilities.
 * No if/switch statements needed for platform selection.
 *
 * Responsibilities:
 * - Coordinate storage provider registration
 * - Provide factory methods for creating storage instances
 * - Select appropriate storage based on environment capabilities
 * - Provide diagnostic information
 *
 * @example
 * ```typescript
 * // Auto-detect and create default storage
 * const storage = StorageManager.createDefaultStorage()
 *
 * // Create specific storage type
 * const nodeStorage = StorageManager.createStorage({ type: 'node', basePath: '/custom/path' })
 *
 * // Use custom storage
 * const customStorage = StorageManager.createStorage({ customStorage: myStorage })
 * ```
 */
export class StorageManager {
  /**
   * Create storage instance with options.
   *
   * @param options - Storage configuration options
   * @returns Configured storage instance
   */
  static createStorage(options?: import('./registry').StorageOptions): Storage {
    return storageRegistry.createStorage(options)
  }

  /**
   * Create default storage based on detected environment.
   * Auto-selects appropriate storage implementation.
   *
   * @param options - Optional storage configuration
   * @returns Storage instance appropriate for current environment
   */
  static createDefaultStorage(
    options?: import('./registry').StorageOptions
  ): Storage {
    return storageRegistry.createStorage(options)
  }

  /**
   * Create storage by explicit type.
   *
   * @param type - Storage type to create
   * @param options - Optional configuration
   * @returns Storage instance of specified type
   */
  static createStorageByType(
    type: 'memory' | 'browser' | 'node' | 'chrome',
    options?: import('./registry').StorageOptions
  ): Storage {
    return storageRegistry.createStorage({ ...options, type })
  }

  /**
   * Get information about the current environment and recommended storage.
   * Useful for debugging and diagnostics.
   *
   * @returns Environment and storage information
   */
  static getStorageInfo(): {
    environment: Environment
    recommendedStorage: string
    availableStorageTypes: string[]
  } {
    const env = detectEnvironment()
    const provider = storageRegistry.findBestProvider()
    const allProviders = storageRegistry.getAllProviders()

    return {
      environment: env,
      recommendedStorage: provider?.name || 'none',
      availableStorageTypes: allProviders.map(p => p.name),
    }
  }
}
