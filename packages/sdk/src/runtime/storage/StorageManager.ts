import { detectEnvironment, Environment } from '../environment'
import { BrowserStorage } from './BrowserStorage'
import { ChromeStorage } from './ChromeStorage'
import { MemoryStorage } from './MemoryStorage'
import { NodeStorage } from './NodeStorage'
import type { Storage } from './types'

/**
 * Options for configuring storage behavior
 */
export type StorageOptions = {
  /**
   * Force a specific storage implementation
   */
  type?: 'memory' | 'browser' | 'node' | 'chrome'

  /**
   * Base path for filesystem storage (Node/Electron)
   */
  basePath?: string

  /**
   * Custom storage implementation
   */
  customStorage?: Storage
}

/**
 * StorageManager handles the creation and configuration of storage instances.
 *
 * Responsibilities:
 * - Auto-detect runtime environment and select appropriate storage
 * - Provide factory methods for creating storage instances
 * - Handle fallback logic when preferred storage is unavailable
 * - Encapsulate all storage implementation details
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
  static createStorage(options?: StorageOptions): Storage {
    // Use custom storage if provided
    if (options?.customStorage) {
      return options.customStorage
    }

    // Use specific type if requested
    if (options?.type) {
      return this.createStorageByType(options.type, options)
    }

    // Auto-detect environment and create appropriate storage
    return this.createDefaultStorage(options)
  }

  /**
   * Create default storage based on detected environment.
   * Auto-selects appropriate storage implementation:
   * - Browser/Electron renderer → BrowserStorage (IndexedDB)
   * - Chrome Extension → ChromeStorage (chrome.storage.local)
   * - Node.js → NodeStorage (filesystem, ~/.vultisig)
   * - Electron main → NodeStorage (userData/.vultisig)
   * - Web Worker → MemoryStorage (with warning)
   *
   * @param options - Optional storage configuration
   * @returns Storage instance appropriate for current environment
   */
  static createDefaultStorage(options?: StorageOptions): Storage {
    const env = detectEnvironment()

    switch (env) {
      case 'browser':
      case 'electron-renderer':
        // Browser and Electron renderer use IndexedDB
        return new BrowserStorage()

      case 'chrome-extension':
      case 'chrome-extension-sw':
        // Chrome extensions use chrome.storage.local API
        // This works in both extension pages and service workers
        return this.createChromeStorageWithFallback()

      case 'node':
        // Node.js uses filesystem storage in home directory
        return new NodeStorage(
          options?.basePath ? { basePath: options.basePath } : undefined
        )

      case 'electron-main':
        // Electron main process uses userData directory
        return this.createElectronMainStorage(options)

      case 'worker':
        // Web Workers can't reliably access IndexedDB, use memory
        console.warn(
          'Running in Web Worker - using in-memory storage (data will not persist)'
        )
        return new MemoryStorage()

      default:
        // Unknown environment - use memory storage as safe fallback
        console.warn(
          `Unknown environment detected: ${env} - using in-memory storage`
        )
        return new MemoryStorage()
    }
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
    options?: StorageOptions
  ): Storage {
    switch (type) {
      case 'memory':
        return new MemoryStorage()

      case 'browser':
        return new BrowserStorage()

      case 'node':
        return new NodeStorage(
          options?.basePath ? { basePath: options.basePath } : undefined
        )

      case 'chrome':
        return new ChromeStorage()

      default:
        throw new Error(`Unknown storage type: ${type}`)
    }
  }

  /**
   * Create Chrome storage with fallback to memory storage if unavailable.
   *
   * @private
   * @returns ChromeStorage or MemoryStorage fallback
   */
  private static createChromeStorageWithFallback(): Storage {
    try {
      return new ChromeStorage()
    } catch (error) {
      console.warn(
        'Chrome storage not available, falling back to memory storage:',
        error
      )
      return new MemoryStorage()
    }
  }

  /**
   * Create storage for Electron main process with userData directory.
   * Falls back to default Node storage if Electron APIs unavailable.
   *
   * @private
   * @param options - Optional storage configuration
   * @returns NodeStorage configured for Electron or default location
   */
  private static createElectronMainStorage(options?: StorageOptions): Storage {
    // If custom basePath provided, use it
    if (options?.basePath) {
      return new NodeStorage({ basePath: options.basePath })
    }

    // Try to use Electron's userData directory
    try {
      // Dynamic require prevents errors in non-Electron environments
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { app } = require('electron')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path')
      const basePath = path.join(app.getPath('userData'), '.vultisig')
      return new NodeStorage({ basePath })
    } catch (error) {
      console.warn(
        'Failed to access Electron app.getPath, using default Node storage:',
        error
      )
      return new NodeStorage()
    }
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
    let recommendedStorage: string

    switch (env) {
      case 'browser':
      case 'electron-renderer':
        recommendedStorage = 'BrowserStorage (IndexedDB)'
        break
      case 'chrome-extension':
      case 'chrome-extension-sw':
        recommendedStorage = 'ChromeStorage (chrome.storage.local)'
        break
      case 'node':
        recommendedStorage = 'NodeStorage (filesystem)'
        break
      case 'electron-main':
        recommendedStorage = 'NodeStorage (Electron userData)'
        break
      case 'worker':
        recommendedStorage = 'MemoryStorage (non-persistent)'
        break
      default:
        recommendedStorage = 'MemoryStorage (fallback)'
    }

    return {
      environment: env,
      recommendedStorage,
      availableStorageTypes: ['memory', 'browser', 'node', 'chrome'],
    }
  }
}
