/**
 * Browser API Mocks
 *
 * Mock implementations of browser APIs for testing in Node.js environment.
 * Includes IndexedDB, localStorage, and chrome.storage.local mocks.
 */

import { vi } from 'vitest'

/**
 * Setup fake-indexeddb globally
 *
 * This must be called before importing BrowserStorage in tests.
 */
export async function setupIndexedDB(): Promise<void> {
  // Import fake-indexeddb polyfills
  await import('fake-indexeddb/auto')
}

/**
 * Reset IndexedDB to clean state
 */
export async function resetIndexedDB(): Promise<void> {
  if (typeof indexedDB !== 'undefined') {
    const databases = await indexedDB.databases?.()
    if (databases) {
      for (const db of databases) {
        if (db.name) {
          indexedDB.deleteDatabase(db.name)
        }
      }
    }
  }
}

/**
 * Simple localStorage mock
 */
class LocalStorageMock {
  private store: Map<string, string> = new Map()

  get length(): number {
    return this.store.size
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    // Simulate quota exceeded
    const totalSize = this.getTotalSize() + key.length + value.length
    if (totalSize > this.quota) {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError')
    }
    this.store.set(key, value)
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  key(index: number): string | null {
    const keys = Array.from(this.store.keys())
    return keys[index] ?? null
  }

  private getTotalSize(): number {
    let size = 0
    for (const [key, value] of this.store.entries()) {
      size += key.length + value.length
    }
    return size
  }

  // For testing: set quota limit
  quota = 5 * 1024 * 1024 // 5MB default

  setQuota(bytes: number): void {
    this.quota = bytes
  }

  // For testing: get usage
  getUsage(): number {
    return this.getTotalSize()
  }
}

/**
 * Setup localStorage mock
 */
export function setupLocalStorage(): LocalStorageMock {
  const mock = new LocalStorageMock()
  ;(globalThis as any).localStorage = mock
  return mock
}

/**
 * Reset localStorage to clean state
 */
export function resetLocalStorage(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.clear()
  }
}

/**
 * Chrome storage API mock
 */
export type ChromeStorageMock = {
  local: {
    get: ReturnType<typeof vi.fn>
    set: ReturnType<typeof vi.fn>
    remove: ReturnType<typeof vi.fn>
    clear: ReturnType<typeof vi.fn>
    getBytesInUse: ReturnType<typeof vi.fn>
    QUOTA_BYTES: number
    onChanged?: {
      addListener: ReturnType<typeof vi.fn>
      removeListener: ReturnType<typeof vi.fn>
    }
  }
  onChanged?: {
    addListener: ReturnType<typeof vi.fn>
    removeListener: ReturnType<typeof vi.fn>
  }
}

/**
 * Setup chrome.storage.local mock
 */
export function setupChromeStorage(): ChromeStorageMock {
  const store = new Map<string, any>()
  const changeListeners: Array<(changes: any, areaName: string) => void> = []

  const mock: ChromeStorageMock = {
    local: {
      get: vi.fn((keys: string | string[] | null, callback?: (result: any) => void) => {
        const result: Record<string, any> = {}

        if (keys === null || keys === undefined) {
          // Get all keys
          for (const [key, value] of store.entries()) {
            result[key] = value
          }
        } else if (typeof keys === 'string') {
          // Get single key
          if (store.has(keys)) {
            result[keys] = store.get(keys)
          }
        } else if (Array.isArray(keys)) {
          // Get multiple keys
          for (const key of keys) {
            if (store.has(key)) {
              result[key] = store.get(key)
            }
          }
        }

        // Chrome API is callback-based
        if (callback) {
          setTimeout(() => callback(result), 0)
        }

        // Also return a promise (for modern chrome.storage API)
        return Promise.resolve(result)
      }),

      set: vi.fn((items: Record<string, any>, callback?: () => void) => {
        const changes: Record<string, any> = {}

        for (const [key, value] of Object.entries(items)) {
          const oldValue = store.get(key)
          store.set(key, value)

          changes[key] = {
            oldValue,
            newValue: value,
          }
        }

        // Trigger change listeners
        for (const listener of changeListeners) {
          listener(changes, 'local')
        }

        if (callback) {
          setTimeout(callback, 0)
        }

        return Promise.resolve()
      }),

      remove: vi.fn((keys: string | string[], callback?: () => void) => {
        const keysArray = typeof keys === 'string' ? [keys] : keys
        const changes: Record<string, any> = {}

        for (const key of keysArray) {
          if (store.has(key)) {
            changes[key] = {
              oldValue: store.get(key),
              newValue: undefined,
            }
            store.delete(key)
          }
        }

        // Trigger change listeners
        if (Object.keys(changes).length > 0) {
          for (const listener of changeListeners) {
            listener(changes, 'local')
          }
        }

        if (callback) {
          setTimeout(callback, 0)
        }

        return Promise.resolve()
      }),

      clear: vi.fn((callback?: () => void) => {
        const changes: Record<string, any> = {}

        for (const [key, value] of store.entries()) {
          changes[key] = {
            oldValue: value,
            newValue: undefined,
          }
        }

        store.clear()

        // Trigger change listeners
        if (Object.keys(changes).length > 0) {
          for (const listener of changeListeners) {
            listener(changes, 'local')
          }
        }

        if (callback) {
          setTimeout(callback, 0)
        }

        return Promise.resolve()
      }),

      getBytesInUse: vi.fn((keys?: string | string[] | null, callback?: (bytes: number) => void) => {
        let size = 0

        if (!keys) {
          // Calculate total size
          for (const [key, value] of store.entries()) {
            size += key.length + JSON.stringify(value).length
          }
        } else {
          const keysArray = typeof keys === 'string' ? [keys] : keys
          for (const key of keysArray) {
            if (store.has(key)) {
              size += key.length + JSON.stringify(store.get(key)).length
            }
          }
        }

        if (callback) {
          setTimeout(() => callback(size), 0)
        }

        return Promise.resolve(size)
      }),

      QUOTA_BYTES: 10 * 1024 * 1024, // 10MB
    },
  }

  // Add change listener support
  mock.local.onChanged = {
    addListener: vi.fn((listener: (changes: any, areaName: string) => void) => {
      changeListeners.push(listener)
    }),
    removeListener: vi.fn((listener: (changes: any, areaName: string) => void) => {
      const index = changeListeners.indexOf(listener)
      if (index > -1) {
        changeListeners.splice(index, 1)
      }
    }),
  }

  mock.onChanged = mock.local.onChanged

  // Set chrome global
  ;(globalThis as any).chrome = {
    storage: mock,
    runtime: {
      id: 'test-extension-id',
    },
  }

  return mock
}

/**
 * Reset chrome.storage.local to clean state
 */
export function resetChromeStorage(): void {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.clear()
  }
}

/**
 * Remove chrome global
 */
export function removeChromeStorage(): void {
  delete (globalThis as any).chrome
}

/**
 * Setup navigator.storage.estimate mock
 */
export function setupNavigatorStorage(usage = 1024, quota = 50 * 1024 * 1024): void {
  ;(globalThis as any).navigator = {
    ...(globalThis as any).navigator,
    storage: {
      estimate: vi.fn(async () => ({
        usage,
        quota,
      })),
    },
  }
}

/**
 * Update navigator.storage.estimate values
 */
export function updateNavigatorStorage(usage: number, quota: number): void {
  if ((globalThis as any).navigator?.storage?.estimate) {
    ;(globalThis as any).navigator.storage.estimate = vi.fn(async () => ({
      usage,
      quota,
    }))
  }
}

/**
 * Setup all browser APIs at once
 */
export function setupAllBrowserAPIs(): {
  indexedDB: void
  localStorage: LocalStorageMock
  chromeStorage: ChromeStorageMock
  navigator: void
} {
  setupIndexedDB()
  const localStorage = setupLocalStorage()
  const chromeStorage = setupChromeStorage()
  setupNavigatorStorage()

  return {
    indexedDB: undefined,
    localStorage,
    chromeStorage,
    navigator: undefined,
  }
}

/**
 * Reset all browser APIs to clean state
 */
export async function resetAllBrowserAPIs(): Promise<void> {
  await resetIndexedDB()
  resetLocalStorage()
  resetChromeStorage()
}

/**
 * Cleanup all browser API mocks
 */
export async function cleanupAllBrowserAPIs(): Promise<void> {
  await resetIndexedDB()
  resetLocalStorage()
  removeChromeStorage()
  delete (globalThis as any).navigator
}

/**
 * Simulate quota exceeded error
 */
export function simulateQuotaExceeded(): void {
  // For localStorage
  if (typeof localStorage !== 'undefined' && (localStorage as any).setQuota) {
    ;(localStorage as any).setQuota(0)
  }

  // For navigator.storage
  updateNavigatorStorage(50 * 1024 * 1024, 50 * 1024 * 1024) // Full quota
}

/**
 * Simulate storage unavailable (private browsing mode)
 */
export function simulateStorageUnavailable(): void {
  // Remove IndexedDB
  delete (globalThis as any).indexedDB

  // Make localStorage throw on access
  Object.defineProperty(globalThis, 'localStorage', {
    get() {
      throw new Error('localStorage is not available')
    },
  })
}

/**
 * Restore storage availability
 */
export function restoreStorageAvailability(): void {
  setupIndexedDB()
  setupLocalStorage()
}
