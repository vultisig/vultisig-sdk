import {
  STORAGE_VERSION,
  StorageMetadata,
  StoredValue,
  VaultStorage,
} from './types'

/**
 * In-memory storage implementation for testing and temporary vaults.
 * Data is lost when the application is closed.
 *
 * Features:
 * - Simple Map-based storage
 * - No persistence
 * - Automatic metadata tracking
 * - Usage estimation
 */
export class MemoryStorage implements VaultStorage {
  private store = new Map<string, StoredValue>()

  async get<T>(key: string): Promise<T | null> {
    const stored = this.store.get(key)
    if (!stored) return null

    return stored.value as T
  }

  async set<T>(key: string, value: T): Promise<void> {
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: this.store.has(key)
        ? this.store.get(key)!.metadata.createdAt
        : Date.now(),
      lastModified: Date.now(),
    }

    this.store.set(key, { value, metadata })
  }

  async remove(key: string): Promise<void> {
    this.store.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  async clear(): Promise<void> {
    this.store.clear()
  }

  async getUsage(): Promise<number> {
    // Rough estimation of memory usage
    let size = 0
    for (const [key, value] of this.store) {
      size += key.length * 2 // UTF-16 encoding
      size += JSON.stringify(value).length * 2
    }
    return size
  }

  async getQuota(): Promise<number | undefined> {
    // Memory storage is only limited by available RAM
    return undefined
  }
}
