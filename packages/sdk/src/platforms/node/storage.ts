/**
 * Node.js filesystem storage implementation
 * Direct implementation without runtime detection
 */
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

export class FileStorage implements Storage {
  public readonly basePath: string
  private initPromise?: Promise<void>

  constructor(config?: { basePath?: string }) {
    this.basePath = config?.basePath ?? path.join(os.homedir(), '.vultisig')
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
    const sanitized = key.replace(/[/\\]/g, '_')
    if (key.startsWith('cache:')) {
      return path.join(this.basePath, 'cache', `${sanitized}.json`)
    }
    return path.join(this.basePath, `${sanitized}.json`)
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureDirectory()

    try {
      const filePath = this.getFilePath(key)
      try {
        await fs.access(filePath)
      } catch {
        return null
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const stored = JSON.parse(content) as StoredValue<T>
      return stored.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to read value for key "${key}"`, error as Error)
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.ensureDirectory()

    const metadata: StorageMetadata = {
      version: STORAGE_VERSION,
      createdAt: Date.now(),
      lastModified: Date.now(),
    }

    const stored: StoredValue<T> = { value, metadata }

    try {
      const filePath = this.getFilePath(key)
      // Use unique temp file to avoid race conditions with concurrent writes
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`

      // Ensure parent directory exists right before writing
      await fs.mkdir(path.dirname(filePath), { recursive: true })

      await fs.writeFile(tempPath, JSON.stringify(stored, null, 2), {
        encoding: 'utf-8',
        mode: 0o600,
      })

      await fs.rename(tempPath, filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new StorageError(StorageErrorCode.QuotaExceeded, 'Disk space quota exceeded', error as Error)
      }
      throw new StorageError(StorageErrorCode.Unknown, `Failed to write value for key "${key}"`, error as Error)
    }
  }

  async remove(key: string): Promise<void> {
    await this.ensureDirectory()

    try {
      const filePath = this.getFilePath(key)
      try {
        await fs.access(filePath)
        await fs.unlink(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    } catch (error) {
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
          keys.push(file.slice(0, -5))
        }
      }

      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        for (const file of cacheFiles) {
          if (file.endsWith('.json') && !file.endsWith('.tmp')) {
            keys.push(file.slice(0, -5))
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
    await this.ensureDirectory()

    try {
      const files = await fs.readdir(this.basePath)
      await Promise.all(
        files.filter(file => file.endsWith('.json')).map(file => fs.unlink(path.join(this.basePath, file)))
      )

      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        await Promise.all(
          cacheFiles.filter(file => file.endsWith('.json')).map(file => fs.unlink(path.join(cacheDir, file)))
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }
    } catch (error) {
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
