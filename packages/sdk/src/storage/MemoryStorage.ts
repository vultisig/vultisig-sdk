import { Storage, STORAGE_VERSION, StorageMetadata, StoredValue } from './types'

/**
 * In-memory storage implementation for testing and temporary use only.
 *
 * **WARNING: MemoryStorage is non-persistent. All data, including vault keyshares,
 * is permanently lost when the process exits. If you create a vault with
 * MemoryStorage and do not export/back up the vault, you will permanently lose
 * access to any funds stored in that vault.**
 *
 * For production use, rely on the SDK's default platform storage:
 * - Node.js/Electron: `FileStorage` (persists to `~/.vultisig`)
 * - Browser: `BrowserStorage` (IndexedDB with localStorage fallback)
 *
 * Or pass `new Vultisig()` without a storage option to auto-configure.
 */
export class MemoryStorage implements Storage {
  private store = new Map<string, StoredValue>()

  async get<T>(key: string): Promise<T | null> {
    const stored = this.store.get(key)
    if (!stored) return null

    return stored.value as T
  }

  async set<T>(key: string, value: T): Promise<void> {
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: this.store.has(key) ? this.store.get(key)!.metadata.createdAt : Date.now(),
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
