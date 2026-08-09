/**
 * Node.js filesystem storage implementation
 * Direct implementation without runtime detection
 */
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'
import { tryLockFile, unlockFile } from './fileLock'

function getDefaultBasePath(): string {
  const override = process.env.VULTISIG_CONFIG_DIR?.trim()
  return override ? override : path.join(os.homedir(), '.vultisig')
}

const WINDOWS_ENCODED_KEY_PREFIX = '.__vultisig_key__'
const WINDOWS_INVALID_FILENAME_CHARACTERS = /[<>:"/\\|?*]/
const WINDOWS_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function needsWindowsFilenameEncoding(key: string): boolean {
  return (
    key.startsWith(WINDOWS_ENCODED_KEY_PREFIX) ||
    WINDOWS_INVALID_FILENAME_CHARACTERS.test(key) ||
    Array.from(key).some(character => character.charCodeAt(0) < 32) ||
    WINDOWS_RESERVED_FILENAME.test(key) ||
    key.endsWith('.') ||
    key.endsWith(' ')
  )
}

function storageFileName(key: string): string {
  if (process.platform === 'win32' && needsWindowsFilenameEncoding(key)) {
    return `${WINDOWS_ENCODED_KEY_PREFIX}${Buffer.from(key, 'utf8').toString('base64url')}`
  }
  return key.replace(/[/\\]/g, '_')
}

function storageKeyFromFileName(fileName: string): string {
  if (process.platform !== 'win32' || !fileName.startsWith(WINDOWS_ENCODED_KEY_PREFIX)) {
    return fileName
  }

  try {
    const encoded = fileName.slice(WINDOWS_ENCODED_KEY_PREFIX.length)
    const key = Buffer.from(encoded, 'base64url').toString('utf8')
    return needsWindowsFilenameEncoding(key) && storageFileName(key) === fileName ? key : fileName
  } catch {
    return fileName
  }
}

export class FileStorage implements Storage {
  public readonly basePath: string
  private initPromise?: Promise<void>

  constructor(config?: { basePath?: string }) {
    this.basePath = config?.basePath ?? getDefaultBasePath()
  }

  private async ensureDirectory(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async () => {
      try {
        await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 })
        await fs.mkdir(path.join(this.basePath, 'cache'), {
          recursive: true,
          mode: 0o700,
        })
      } catch (error) {
        throw new StorageError(
          StorageErrorCode.PermissionDenied,
          `Failed to create storage directory: ${this.basePath}`,
          error as Error
        )
      }
    })()

    return this.initPromise
  }

  private getFilePath(key: string): string {
    const fileName = storageFileName(key)
    if (key.startsWith('cache:')) {
      return path.join(this.basePath, 'cache', `${fileName}.json`)
    }
    return path.join(this.basePath, `${fileName}.json`)
  }

  private async readValue<T>(key: string): Promise<T | null> {
    try {
      const content = await fs.readFile(this.getFilePath(key), 'utf-8')
      const stored = JSON.parse(content) as StoredValue<T>
      return stored.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async writeValue<T>(key: string, value: T): Promise<void> {
    const filePath = this.getFilePath(key)
    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    }
    const stored: StoredValue<T> = { value, metadata }
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`

    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(tempPath, JSON.stringify(stored, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
    await fs.rename(tempPath, filePath)
  }

  private async removeValue(key: string): Promise<void> {
    await fs.unlink(this.getFilePath(key)).catch(error => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }

  private async withStorageLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    await this.ensureDirectory()
    const lockPath = path.join(this.basePath, '.storage.lock')
    const startedAt = Date.now()
    // Keep one storage-wide sentinel stable: advisory locks are inode-scoped,
    // and replacing or unlinking it could split contenders across locks. The
    // kernel releases the lock automatically when a process exits.
    const lockHandle = await fs.open(lockPath, 'a+', 0o600)
    let acquired = false

    try {
      while (!acquired) {
        acquired = tryLockFile(lockHandle.fd)
        if (acquired) break

        if (Date.now() - startedAt > 5_000) {
          throw new StorageError(StorageErrorCode.StorageUnavailable, `Timed out locking value for key "${key}"`)
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      return await operation()
    } finally {
      try {
        if (acquired) {
          unlockFile(lockHandle.fd)
        }
      } finally {
        await lockHandle.close()
      }
    }
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureDirectory()

    try {
      return await this.readValue<T>(key)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to read value for key "${key}"`, error as Error)
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    try {
      await this.withStorageLock(key, () => this.writeValue(key, value))
    } catch (error) {
      if (error instanceof StorageError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new StorageError(StorageErrorCode.QuotaExceeded, 'Disk space quota exceeded', error as Error)
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to write value for key "${key}"`, error as Error)
    }
  }

  async compareAndSet<T>(key: string, expectedValue: T | null, value: T | null): Promise<boolean> {
    try {
      return await this.withStorageLock(key, async () => {
        const currentValue = await this.readValue<T>(key)
        if (JSON.stringify(currentValue) !== JSON.stringify(expectedValue)) {
          return false
        }

        if (value === null) {
          await this.removeValue(key)
        } else {
          await this.writeValue(key, value)
        }
        return true
      })
    } catch (error) {
      if (error instanceof StorageError) throw error
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new StorageError(StorageErrorCode.QuotaExceeded, 'Disk space quota exceeded', error as Error)
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to conditionally write key "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.withStorageLock(key, () => this.removeValue(key))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, `Failed to remove key "${key}"`, error as Error)
    }
  }

  async list(): Promise<string[]> {
    await this.ensureDirectory()

    try {
      const keys: string[] = []

      const files = await fs.readdir(this.basePath)
      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.tmp')) {
          keys.push(storageKeyFromFileName(file.slice(0, -5)))
        }
      }

      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        for (const file of cacheFiles) {
          if (file.endsWith('.json') && !file.endsWith('.tmp')) {
            keys.push(storageKeyFromFileName(file.slice(0, -5)))
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      return keys
    } catch (error) {
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to list keys', error as Error)
    }
  }

  async clear(): Promise<void> {
    try {
      await this.withStorageLock('*', async () => {
        await Promise.all((await this.list()).map(key => this.removeValue(key)))
      })
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw new StorageError(StorageErrorCode.Unknown, 'Failed to clear storage', error as Error)
    }
  }

  async getUsage(): Promise<number> {
    await this.ensureDirectory()

    try {
      let totalSize = 0

      const files = await fs.readdir(this.basePath)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.basePath, file)
          const stats = await fs.stat(filePath)
          totalSize += stats.size
        }
      }

      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        for (const file of cacheFiles) {
          if (file.endsWith('.json')) {
            const filePath = path.join(cacheDir, file)
            const stats = await fs.stat(filePath)
            totalSize += stats.size
          }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('Failed to calculate cache usage:', error)
        }
      }

      return totalSize
    } catch (error) {
      console.warn('Failed to calculate storage usage:', error)
      return 0
    }
  }

  async getQuota(): Promise<number | undefined> {
    return undefined
  }

  async getMetadata(key: string): Promise<StorageMetadata | null> {
    await this.ensureDirectory()

    try {
      const filePath = this.getFilePath(key)
      const content = await fs.readFile(filePath, 'utf-8')
      const stored = JSON.parse(content) as StoredValue
      return stored.metadata
    } catch {
      return null
    }
  }
}
