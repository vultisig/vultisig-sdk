/// <reference types="chrome" />
/**
 * Chrome Extension storage implementation using chrome.storage.local
 *
 * Works in all extension contexts: service worker, popup, content script, options page.
 * Unlike BrowserStorage (IndexedDB/localStorage), this uses the Chrome Extension
 * Storage API which is reliable in Manifest V3 service workers.
 */
import { storageValuesEqual } from '../../storage/storageValuesEqual'
import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

export class ChromeExtensionStorage implements Storage {
  private hasExtensionScopedMutationLock(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      Boolean(navigator.locks) &&
      typeof location !== 'undefined' &&
      location.protocol === 'chrome-extension:'
    )
  }

  private async withMutationLock<T>(operation: () => Promise<T>, required = false): Promise<T> {
    if (!this.hasExtensionScopedMutationLock()) {
      if (required) {
        throw new StorageError(
          StorageErrorCode.StorageUnavailable,
          'Atomic storage mutations require extension-origin Web Locks; content-script locks are origin-partitioned'
        )
      }
      return operation()
    }
    return navigator.locks.request('vultisig-extension-storage', operation)
  }

  private async setValue<T>(key: string, value: T): Promise<void> {
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    }
    await chrome.storage.local.set({
      [key]: { value, metadata } satisfies StoredValue<T>,
    })
  }

  private ensureAvailable(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'chrome.storage.local is not available. Ensure the "storage" permission is declared in manifest.json.'
      )
    }
  }

  async get<T>(key: string): Promise<T | null> {
    this.ensureAvailable()

    try {
      const result = await chrome.storage.local.get(key)
      const stored = result[key] as StoredValue<T> | undefined
      return stored ? stored.value : null
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, `Failed to get value for key "${key}"`, error as Error)
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.ensureAvailable()

    try {
      await this.withMutationLock(() => this.setValue(key, value), true)
    } catch (error) {
      if ((error as Error).message?.includes('QUOTA_BYTES')) {
        throw new StorageError(
          StorageErrorCode.QuotaExceeded,
          'Chrome extension storage quota exceeded',
          error as Error
        )
      }
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to set value for key "${key}"`, error as Error)
    }
  }

  async compareAndSet<T>(key: string, expectedValue: T | null, value: T | null): Promise<boolean> {
    this.ensureAvailable()
    try {
      return await this.withMutationLock(async () => {
        const currentValue = await this.get<T>(key)
        if (!storageValuesEqual(currentValue, expectedValue)) {
          return false
        }
        if (value === null) {
          await chrome.storage.local.remove(key)
        } else {
          await this.setValue(key, value)
        }
        return true
      }, true)
    } catch (error) {
      if (error instanceof StorageError) throw error
      if ((error as Error).message?.includes('QUOTA_BYTES')) {
        throw new StorageError(
          StorageErrorCode.QuotaExceeded,
          'Chrome extension storage quota exceeded',
          error as Error
        )
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to conditionally write key "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    this.ensureAvailable()

    try {
      await this.withMutationLock(() => chrome.storage.local.remove(key), true)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to remove key "${key}"`, error as Error)
    }
  }

  async list(): Promise<string[]> {
    this.ensureAvailable()

    try {
      const all = await chrome.storage.local.get(null)
      return Object.keys(all)
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to list keys', error as Error)
    }
  }

  async clear(): Promise<void> {
    this.ensureAvailable()

    try {
      await this.withMutationLock(() => chrome.storage.local.clear(), true)
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to clear storage', error as Error)
    }
  }

  async getUsage(): Promise<number> {
    this.ensureAvailable()

    try {
      return await chrome.storage.local.getBytesInUse(null)
    } catch {
      return 0
    }
  }

  async getQuota(): Promise<number | undefined> {
    this.ensureAvailable()

    return chrome.storage.local.QUOTA_BYTES
  }
}
