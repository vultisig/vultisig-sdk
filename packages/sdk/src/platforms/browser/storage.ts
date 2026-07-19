/**
 * Browser storage implementation with IndexedDB and localStorage fallback
 * Direct implementation without runtime detection
 */
import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

type StorageMode = 'indexeddb' | 'localstorage'

const BACKEND_MARKER_KEY = '__vultisig_storage_backend__'

export class BrowserStorage implements Storage {
  private db?: IDBDatabase
  private mode?: StorageMode
  private initializationError?: StorageError
  private readonly initialization: Promise<void>
  private readonly dbName = 'vultisig-vaults'
  private readonly storeName = 'vaults'
  private readonly dbVersion = 1

  constructor() {
    this.initialization = this.initializeAsync().catch(error => {
      this.initializationError =
        error instanceof StorageError
          ? error
          : new StorageError(
              StorageErrorCode.StorageUnavailable,
              'Browser storage initialization failed',
              error as Error
            )
    })
  }

  private async initializeAsync(): Promise<void> {
    const persistedMode = this.readPersistedMode()

    if (persistedMode === 'localstorage') {
      this.tryLocalStorage()
      this.mode = 'localstorage'
      return
    }

    if (persistedMode === 'indexeddb' || typeof indexedDB !== 'undefined') {
      await this.tryIndexedDB()
      await this.verifyIndexedDB()

      if (!persistedMode) {
        const indexedDBKeys = await this.listFromIndexedDB()
        const legacyLocalKeys = this.listLocalStorageSdkKeys()

        if (legacyLocalKeys.length > 0 && indexedDBKeys.length === 0) {
          this.db?.close()
          this.db = undefined
          this.tryLocalStorage()
          this.mode = 'localstorage'
          this.persistMode('localstorage')
          return
        }

        if (legacyLocalKeys.length > 0 && indexedDBKeys.length > 0) {
          this.db?.close()
          this.db = undefined
          throw new StorageError(
            StorageErrorCode.StorageUnavailable,
            'Browser storage contains unverified data in both IndexedDB and localStorage'
          )
        }
      }

      this.mode = 'indexeddb'
      this.persistMode('indexeddb')
      return
    }

    this.tryLocalStorage()
    this.mode = 'localstorage'
    this.persistMode('localstorage')
  }

  private async ensureInitialized(): Promise<void> {
    await this.initialization
    if (this.initializationError) {
      throw this.initializationError
    }
    if (!this.mode) {
      throw new StorageError(StorageErrorCode.StorageUnavailable, 'Browser storage backend was not selected')
    }
  }

  private readPersistedMode(): StorageMode | undefined {
    if (typeof localStorage === 'undefined') return undefined

    try {
      const value = localStorage.getItem(BACKEND_MARKER_KEY)
      return value === 'indexeddb' || value === 'localstorage' ? value : undefined
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'Browser storage backend marker could not be read',
        error as Error
      )
    }
  }

  private persistMode(mode: StorageMode): void {
    if (typeof localStorage === 'undefined') return

    try {
      localStorage.setItem(BACKEND_MARKER_KEY, mode)
    } catch {
      // IndexedDB remains authoritative even when localStorage cannot retain the
      // advisory marker. A localStorage backend has already passed its health
      // check, so failure here is treated as initialization failure below.
      if (mode === 'localstorage') {
        throw new StorageError(StorageErrorCode.StorageUnavailable, 'Failed to persist browser storage backend')
      }
    }
  }

  private async tryIndexedDB(): Promise<void> {
    if (typeof indexedDB === 'undefined') {
      throw new StorageError(StorageErrorCode.StorageUnavailable, 'IndexedDB not available')
    }

    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion)
      let settled = false

      request.onerror = () => {
        settled = true
        reject(
          new StorageError(
            StorageErrorCode.StorageUnavailable,
            'IndexedDB could not be opened',
            request.error ?? undefined
          )
        )
      }

      request.onblocked = () => {
        settled = true
        reject(new StorageError(StorageErrorCode.StorageUnavailable, 'IndexedDB open was blocked'))
      }

      request.onsuccess = () => {
        if (settled) {
          request.result.close()
          return
        }
        settled = true
        this.db = request.result
        this.db.onversionchange = () => this.db?.close()
        resolve()
      }

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName)
        }
      }
    })
  }

  private async verifyIndexedDB(): Promise<void> {
    try {
      await this.listFromIndexedDB()
    } catch (error) {
      this.db?.close()
      this.db = undefined
      throw new StorageError(StorageErrorCode.StorageUnavailable, 'IndexedDB health check failed', error as Error)
    }
  }

  private tryLocalStorage(): void {
    if (typeof localStorage === 'undefined') {
      throw new StorageError(StorageErrorCode.StorageUnavailable, 'localStorage not available')
    }

    const testKey = '__vultisig_test__'
    try {
      localStorage.setItem(testKey, 'test')
      localStorage.removeItem(testKey)
    } catch (error) {
      throw new StorageError(StorageErrorCode.PermissionDenied, 'localStorage not writable', error as Error)
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        return await this.getFromIndexedDB<T>(key)
      } else {
        return this.getFromLocalStorage<T>(key)
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to get value for key "${key}"`, error as Error)
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
      } else {
        this.setToLocalStorage(key, stored)
      }
    } catch (error) {
      if ((error as Error).name === 'QuotaExceededError') {
        throw new StorageError(StorageErrorCode.QuotaExceeded, 'Browser storage quota exceeded', error as Error)
      }
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to set value for key "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        await this.removeFromIndexedDB(key)
      } else {
        localStorage.removeItem(key)
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to remove key "${key}"`, error as Error)
    }
  }

  async list(): Promise<string[]> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        return await this.listFromIndexedDB()
      } else {
        return this.listFromLocalStorage()
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to list keys', error as Error)
    }
  }

  async clear(): Promise<void> {
    await this.ensureInitialized()

    try {
      if (this.mode === 'indexeddb' && this.db) {
        await this.clearIndexedDB()
      } else {
        const keys = this.listFromLocalStorage()
        keys.forEach(key => localStorage.removeItem(key))
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to clear storage', error as Error)
    }
  }

  async getUsage(): Promise<number> {
    await this.ensureInitialized()

    if (this.mode === 'indexeddb' && typeof navigator !== 'undefined' && navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()
        return estimate.usage || 0
      } catch {
        return 0
      }
    }

    const keys = await this.list()
    let size = 0
    for (const key of keys) {
      const value = await this.get(key)
      size += key.length * 2
      size += JSON.stringify(value).length * 2
    }
    return size
  }

  async getQuota(): Promise<number | undefined> {
    await this.ensureInitialized()

    if (this.mode === 'indexeddb' && typeof navigator !== 'undefined' && navigator.storage) {
      try {
        const estimate = await navigator.storage.estimate()
        return estimate.quota
      } catch {
        return undefined
      }
    }

    if (this.mode === 'localstorage') {
      return 10 * 1024 * 1024
    }

    return undefined
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    const value = await this.get(key)
    return value
      ? {
          version: STORAGE_VERSION,
          createdAt: Date.now(),
          lastModified: Date.now(),
        }
      : null
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

  private async setToIndexedDB<T>(key: string, value: StoredValue<T>): Promise<void> {
    const transaction = this.db!.transaction(this.storeName, 'readwrite')
    const completion = this.waitForTransaction(transaction)
    transaction.objectStore(this.storeName).put(value, key)
    return completion
  }

  private async removeFromIndexedDB(key: string): Promise<void> {
    const transaction = this.db!.transaction(this.storeName, 'readwrite')
    const completion = this.waitForTransaction(transaction)
    transaction.objectStore(this.storeName).delete(key)
    return completion
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
    const transaction = this.db!.transaction(this.storeName, 'readwrite')
    const completion = this.waitForTransaction(transaction)
    transaction.objectStore(this.storeName).clear()
    return completion
  }

  private waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const rejectOnce = (error: DOMException | null | undefined) => {
        if (settled) return
        settled = true
        reject(error ?? new DOMException('IndexedDB transaction failed', 'UnknownError'))
      }

      transaction.oncomplete = () => {
        if (settled) return
        settled = true
        resolve()
      }
      transaction.onerror = event => {
        const requestError = (event.target as IDBRequest | null)?.error
        rejectOnce(requestError ?? transaction.error)
      }
      transaction.onabort = () => rejectOnce(transaction.error)
    })
  }

  // ===== localStorage Operations =====

  private getFromLocalStorage<T>(key: string): T | null {
    const stored = localStorage.getItem(key)
    if (!stored) return null

    try {
      const parsed = JSON.parse(stored) as StoredValue<T>
      return parsed.value
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.SerializationFailed,
        `Stored value for key "${key}" is invalid`,
        error as Error
      )
    }
  }

  private setToLocalStorage<T>(key: string, value: StoredValue<T>): void {
    localStorage.setItem(key, JSON.stringify(value))
  }

  private listFromLocalStorage(): string[] {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key !== BACKEND_MARKER_KEY) keys.push(key)
    }
    return keys
  }

  private listLocalStorageSdkKeys(): string[] {
    if (typeof localStorage === 'undefined') return []

    try {
      return this.listFromLocalStorage().filter(
        key =>
          key.startsWith('vault:') ||
          key.startsWith('pending:') ||
          key.startsWith('cache:') ||
          key.startsWith('addressBook:') ||
          key === 'activeVaultId' ||
          key === 'pushNotificationRegistrations' ||
          key === 'config:defaultCurrency' ||
          key === 'config:defaultChains'
      )
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.StorageUnavailable,
        'Legacy browser storage keys could not be inspected',
        error as Error
      )
    }
  }
}
