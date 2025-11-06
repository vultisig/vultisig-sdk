/**
 * Chrome Extension Storage implementation using chrome.storage.local API.
 *
 * This storage implementation is specifically designed for Chrome extensions:
 * - Works in service workers (background scripts)
 * - Persists across service worker restarts
 * - Syncs across extension contexts (popup, options, background)
 * - Default quota: ~10MB (chrome.storage.local.QUOTA_BYTES)
 *
 * Security Notes:
 * - Data is stored unencrypted in extension storage
 * - Only accessible by the extension (isolated from other extensions)
 * - Use vault encryption for sensitive data
 *
 * @example
 * ```typescript
 * import { Vultisig, ChromeStorage } from '@vultisig/sdk'
 *
 * // Manual usage
 * const sdk = new Vultisig({
 *   storage: new ChromeStorage()
 * })
 *
 * // Or let SDK auto-detect (if chrome extension detection is enabled)
 * const sdk = new Vultisig() // Auto-uses ChromeStorage in extensions
 * ```
 */

import type { VaultStorage, StorageMetadata, StoredValue, STORAGE_VERSION } from './types'
import { StorageError, StorageErrorCode } from './types'

export class ChromeStorage implements VaultStorage {
  constructor() {
    // Verify chrome.storage API is available
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'Chrome storage API not available. This storage can only be used in Chrome extensions.'
      )
    }
  }

  /**
   * Get value from storage
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const result = await chrome.storage.local.get(key)
      const stored = result[key] as StoredValue<T> | undefined

      if (!stored) {
        return null
      }

      // Handle StoredValue wrapper format
      if (stored && typeof stored === 'object' && 'value' in stored) {
        return stored.value
      }

      // Handle direct value (backwards compatibility)
      return stored as T
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to get item from Chrome storage: ${key}`,
        error as Error
      )
    }
  }

  /**
   * Set value in storage
   */
  async set<T>(key: string, value: T): Promise<void> {
    try {
      const stored: StoredValue<T> = {
        value,
        metadata: {
          version: 1,
          createdAt: Date.now(),
          lastModified: Date.now(),
        },
      }

      await chrome.storage.local.set({ [key]: stored })
    } catch (error) {
      // Check for quota exceeded
      if (error instanceof Error && error.message.includes('QUOTA_BYTES')) {
        throw new StorageError(
          StorageErrorCode.QuotaExceeded,
          'Chrome extension storage quota exceeded',
          error
        )
      }

      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to set item in Chrome storage: ${key}`,
        error as Error
      )
    }
  }

  /**
   * Remove value from storage
   */
  async remove(key: string): Promise<void> {
    try {
      await chrome.storage.local.remove(key)
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to remove item from Chrome storage: ${key}`,
        error as Error
      )
    }
  }

  /**
   * Clear all storage
   */
  async clear(): Promise<void> {
    try {
      await chrome.storage.local.clear()
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        'Failed to clear Chrome storage',
        error as Error
      )
    }
  }

  /**
   * Get all storage keys
   */
  async list(): Promise<string[]> {
    try {
      const items = await chrome.storage.local.get(null)
      return Object.keys(items)
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        'Failed to get keys from Chrome storage',
        error as Error
      )
    }
  }

  /**
   * Get total storage usage in bytes
   */
  async getUsage(): Promise<number> {
    try {
      // chrome.storage.local.getBytesInUse() can take keys or null for all
      const usage = await chrome.storage.local.getBytesInUse(null)
      return usage
    } catch (error) {
      // Fallback: estimate from all items
      try {
        const items = await chrome.storage.local.get(null)
        const size = new Blob([JSON.stringify(items)]).size
        return size
      } catch {
        throw new StorageError(
          StorageErrorCode.Unknown,
          'Failed to get Chrome storage usage',
          error as Error
        )
      }
    }
  }

  /**
   * Get storage quota in bytes
   */
  async getQuota(): Promise<number | undefined> {
    // Chrome extension storage quota
    // chrome.storage.local.QUOTA_BYTES is typically 10MB (10,485,760 bytes)
    // Note: Starting Chrome 102, this can be unlimited with "unlimitedStorage" permission
    return (chrome.storage.local as any).QUOTA_BYTES ?? 10_485_760 // 10MB default
  }

  /**
   * Check if Chrome extension has unlimited storage permission
   */
  async hasUnlimitedStorage(): Promise<boolean> {
    if (!chrome.permissions) {
      return false
    }

    try {
      const permissions = await chrome.permissions.getAll()
      return permissions.permissions?.includes('unlimitedStorage') ?? false
    } catch {
      return false
    }
  }

  /**
   * Listen for storage changes across extension contexts
   * Useful for syncing state between popup, options, and background
   *
   * @param callback - Called when storage changes
   * @returns Cleanup function to stop listening
   *
   * @example
   * ```typescript
   * const unsubscribe = storage.onChanged((changes) => {
   *   if (changes.activeVaultId) {
   *     console.log('Active vault changed:', changes.activeVaultId.newValue)
   *   }
   * })
   * ```
   */
  onChanged(
    callback: (changes: {
      [key: string]: { oldValue?: unknown; newValue?: unknown }
    }) => void
  ): () => void {
    const listener = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local') {
        callback(changes)
      }
    }

    chrome.storage.onChanged.addListener(listener)

    // Return cleanup function
    return () => {
      chrome.storage.onChanged.removeListener(listener)
    }
  }
}
