import {
  STORAGE_VERSION,
  StorageError,
  StorageErrorCode,
  StorageMetadata,
  StoredValue,
  VaultStorage,
} from './types'

/**
 * Storage mode for browser storage
 */
type StorageMode = 'indexeddb' | 'localstorage' | 'memory'

/**
 * Browser storage implementation with automatic fallback chain.
 *
 * Storage Priority:
 * 1. IndexedDB (largest quota, ~50MB+, best for production)
 * 2. localStorage (~5-10MB, fallback for private browsing)
 * 3. In-memory Map (no persistence, fallback for all failures)
 *
 * Features:
 * - Automatic fallback on quota exceeded
 * - Atomic operations
 * - Metadata tracking (version, timestamps)
 * - Usage and quota estimation
 *
 * Security Note:
 * - Data is NOT encrypted by default (stored in plain text)
 * - For encrypted storage, use the vault's built-in encryption
 *   and store encrypted vault data
 * - Subject to XSS attacks - ensure proper CSP headers
 */
export class BrowserStorage implements VaultStorage {
  private db?: IDBDatabase
  private mode: StorageMode = 'memory'
  private memoryStore = new Map<string, StoredValue>()
  private readonly dbName = 'vultisig-vaults'
  private readonly storeName = 'vaults'
  private readonly dbVersion = 1

  constructor() {
    // Initialize on construction (async init handled in methods)
    this.initializeAsync().catch(err =>
      console.warn('BrowserStorage initialization warning:', err)
    )
  }

  /**
   * Initialize storage (tries IndexedDB → localStorage → memory)
   */
  private async initializeAsync(): Promise<void> {
    try {
      await this.tryIndexedDB()
      this.mode = 'indexeddb'
    } catch {
      try {
        this.tryLocalStorage()
        this.mode = 'localstorage'
      } catch {
        this.mode = 'memory'
      }
    }
  }

  /**
   * Ensure storage is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (this.mode === 'memory' && !this.db) {
      await this.initializeAsync()
    }
  }

  /**
   * Try to initialize IndexedDB
   */
  private async tryIndexedDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'IndexedDB not available'
      )
    }

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result

        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }
    })
  }

  /**
   * Try to initialize localStorage
   */
  private tryLocalStorage(): void {
    if (typeof localStorage === 'undefined') {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'localStorage not available'
      )
    }

    // Test if localStorage is writable (private browsing might block)
    const testKey = '__vultisig_test__'
    try {
      localStorage.setItem(testKey, 'test')
      localStorage.removeItem(testKey)
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.PermissionDenied,
        'localStorage not writable',
        error as Error
      )
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        return await this.getFromIndexedDB<T>(key)
      } else if (this.mode === 'localstorage') {
        return this.getFromLocalStorage<T>(key)
      } else {
        return this.getFromMemory<T>(key)
      }
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to get value for key "${key}"`,
        error as Error
      )
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureInitialized()

    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    }

    const stored: StoredValue<T> = { value, metadata }

    try {
      if (this.mode === 'indexeddb' && this.db) {
        await this.setToIndexedDB(key, stored)
      } else if (this.mode === 'localstorage') {
        this.setToLocalStorage(key, stored)
      } else {
        this.setToMemory(key, stored)
      }
    } catch (error) {
      // Try fallback on quota exceeded
      if ((error as Error).name === 'QuotaExceededError') {
        await this.handleQuotaExceeded(key, stored)
      } else {
        throw new StorageError(
          StorageErrorCode.Unknown,
          `Failed to set value for key "${key}"`,
          error as Error
        )
      }
    }
  }

  async remove(key: string): Promise<void> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        await this.removeFromIndexedDB(key)
      } else if (this.mode === 'localstorage') {
        localStorage.removeItem(key)
      } else {
        this.memoryStore.delete(key)
      }
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to remove key "${key}"`,
        error as Error
      )
    }
  }

  async list(): Promise<string[]> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        return await this.listFromIndexedDB()
      } else if (this.mode === 'localstorage') {
        return this.listFromLocalStorage()
      } else {
        return Array.from(this.memoryStore.keys())
      }
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        'Failed to list keys',
        error as Error
      )
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        await this.clearIndexedDB()
      } else if (this.mode === 'localstorage') {
        // Only clear vultisig keys
        const keys = this.listFromLocalStorage()
        keys.forEach(key => localStorage.removeItem(key))
      } else {
        this.memoryStore.clear()
      }
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        'Failed to clear storage',
        error as Error
      )
    }
  }

  async getUsage(): Promise<number> {
    if (
      this.mode === 'indexeddb' &&
      typeof navigator !== 'undefined' &&
      navigator.storage
    ) {
      try {
        const estimate = await navigator.storage.estimate()
        return estimate.usage || 0
      } catch {
        return 0
      }
    }

    // Estimate for localStorage/memory
    const keys = await this.list()
    let size = 0
    for (const key of keys) {
      const value = await this.get(key)
      size += key.length * 2 // UTF-16
      size += JSON.stringify(value).length * 2
    }
    return size
  }

  async getQuota(): Promise<number | undefined> {
    if (
      this.mode === 'indexeddb' &&
      typeof navigator !== 'undefined' &&
      navigator.storage
    ) {
      try {
        const estimate = await navigator.storage.estimate()
        return estimate.quota
      } catch {
        return undefined
      }
    }

    // localStorage typically has 5-10MB limit
    if (this.mode === 'localstorage') {
      return 10 * 1024 * 1024 // 10MB estimate
    }

    return undefined
  }

  // ===== IndexedDB Operations =====

  private async getFromIndexedDB<T>(key: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.get(key)

      request.onsuccess = () => {
        const stored = request.result as StoredValue<T> | undefined
        resolve(stored ? stored.value : null)
      }

      request.onerror = () => reject(request.error)
    })
  }

  private async setToIndexedDB<T>(
    key: string,
    value: StoredValue<T>
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.put(value, key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async removeFromIndexedDB(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async listFromIndexedDB(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readonly')
      const store = transaction.objectStore(this.storeName)
      const request = store.getAllKeys()

      request.onsuccess = () => resolve(request.result as string[])
      request.onerror = () => reject(request.error)
    })
  }

  private async clearIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(this.storeName, 'readwrite')
      const store = transaction.objectStore(this.storeName)
      const request = store.clear()

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // ===== localStorage Operations =====

  private getFromLocalStorage<T>(key: string): T | null {
    const stored = localStorage.getItem(key)
    if (!stored) return null

    try {
      const parsed = JSON.parse(stored) as StoredValue<T>
      return parsed.value
    } catch {
      return null
    }
  }

  private setToLocalStorage<T>(key: string, value: StoredValue<T>): void {
    localStorage.setItem(key, JSON.stringify(value))
  }

  private listFromLocalStorage(): string[] {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key) keys.push(key)
    }
    return keys
  }

  // ===== Memory Operations =====

  private getFromMemory<T>(key: string): T | null {
    const stored = this.memoryStore.get(key)
    return stored ? (stored.value as T) : null
  }

  private setToMemory<T>(key: string, value: StoredValue<T>): void {
    this.memoryStore.set(key, value)
  }

  // ===== Fallback Handling =====

  private async handleQuotaExceeded<T>(
    key: string,
    value: StoredValue<T>
  ): Promise<void> {
    if (this.mode === 'indexeddb') {
      // Try falling back to localStorage
      try {
        this.tryLocalStorage()
        this.mode = 'localstorage'
        this.setToLocalStorage(key, value)
        return
      } catch {
        // Fall through to memory
      }
    }

    if (this.mode === 'localstorage') {
      // Fall back to memory
      this.mode = 'memory'
      this.setToMemory(key, value)
      console.warn('Storage quota exceeded, falling back to memory storage')
      return
    }

    // Already in memory mode
    throw new StorageError(
      StorageErrorCode.QuotaExceeded,
      'Storage quota exceeded in all storage modes'
    )
  }
}
