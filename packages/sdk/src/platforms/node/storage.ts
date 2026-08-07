/**
 * Node.js filesystem storage implementation
 * Direct implementation without runtime detection
 */
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import type { Storage, StorageMetadata, StoredValue } from '../../storage/types'
import { STORAGE_VERSION, StorageError, StorageErrorCode } from '../../storage/types'

type FileLockOwner = {
  id: string
  pid: number
  hostname: string
}

function getDefaultBasePath(): string {
  const override = process.env.VULTISIG_CONFIG_DIR?.trim()
  return override ? override : path.join(os.homedir(), '.vultisig')
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
    const sanitized = key.replace(/[/\\]/g, '_')
    if (key.startsWith('cache:')) {
      return path.join(this.basePath, 'cache', `${sanitized}.json`)
    }
    return path.join(this.basePath, `${sanitized}.json`)
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

  private async readLockOwner(lockPath: string): Promise<FileLockOwner | undefined> {
    try {
      const owner = JSON.parse(await fs.readFile(lockPath, 'utf-8')) as Partial<FileLockOwner>
      return typeof owner.id === 'string' && typeof owner.pid === 'number' && typeof owner.hostname === 'string'
        ? (owner as FileLockOwner)
        : undefined
    } catch {
      return undefined
    }
  }

  private isOwnerProcessDead(owner: FileLockOwner): boolean {
    if (owner.hostname !== os.hostname() || owner.pid === process.pid) return false
    try {
      process.kill(owner.pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ESRCH'
    }
  }

  private async withKeyLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    await this.ensureDirectory()
    const lockPath = `${this.getFilePath(key)}.lock`
    const startedAt = Date.now()
    const owner: FileLockOwner = {
      id: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      pid: process.pid,
      hostname: os.hostname(),
    }
    const ownerPath = `${lockPath}.${owner.id}.owner`
    await fs.writeFile(ownerPath, JSON.stringify(owner), {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    })
    let acquired = false

    try {
      while (!acquired) {
        try {
          await fs.link(ownerPath, lockPath)
          acquired = true
          continue
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw new StorageError(StorageErrorCode.Unknown, `Failed to lock value for key "${key}"`, error as Error)
          }
        }

        const currentOwner = await this.readLockOwner(lockPath)
        if (currentOwner && this.isOwnerProcessDead(currentOwner)) {
          const confirmedOwner = await this.readLockOwner(lockPath)
          if (confirmedOwner?.id === currentOwner.id) {
            await fs.unlink(lockPath).catch(error => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            })
            await fs.unlink(`${lockPath}.${currentOwner.id}.owner`).catch(error => {
              if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
            })
          }
          continue
        }

        if (Date.now() - startedAt > 5_000) {
          throw new StorageError(StorageErrorCode.StorageUnavailable, `Timed out locking value for key "${key}"`)
        }
        await new Promise(resolve => setTimeout(resolve, 10))
      }

      return await operation()
    } finally {
      try {
        if (acquired && (await this.readLockOwner(lockPath))?.id === owner.id) {
          await fs.unlink(lockPath).catch(error => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          })
        }
      } finally {
        await fs.unlink(ownerPath).catch(error => {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        })
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
      await this.withKeyLock(key, () => this.writeValue(key, value))
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
      return await this.withKeyLock(key, async () => {
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
      await this.withKeyLock(key, () => this.removeValue(key))
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
    try {
      await Promise.all((await this.list()).map(key => this.remove(key)))
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
