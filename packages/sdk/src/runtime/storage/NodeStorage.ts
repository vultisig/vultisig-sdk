import {
  Storage,
  STORAGE_VERSION,
  StorageError,
  StorageErrorCode,
  StorageMetadata,
  StoredValue,
} from './types'

/**
 * Node.js filesystem storage implementation with Electron support.
 *
 * Features:
 * - Filesystem-based persistent storage
 * - Atomic writes using temp files + rename
 * - Electron-aware (auto-detects userData directory)
 * - JSON serialization with metadata
 * - Automatic directory creation
 *
 * Default Paths:
 * - Electron: `app.getPath('userData')/.vultisig`
 * - Node.js: `~/.vultisig`
 * - Custom: User-specified path
 *
 * Security Note:
 * - Files are stored as plain JSON (not encrypted by default)
 * - File permissions: 0600 (owner read/write only)
 * - Ensure proper OS-level security and disk encryption
 *
 * Implementation Note:
 * - Node.js modules (path, os, electron) are loaded via require() instead of top-level imports
 * - This prevents bundler errors when this file is included in browser/extension builds
 * - StorageManager imports all storage implementations, so top-level imports would fail in browsers
 */
export class NodeStorage implements Storage {
  public readonly basePath: string
  private initPromise?: Promise<void>

  constructor(config?: { basePath?: string }) {
    this.basePath = config?.basePath ?? this.getDefaultPath()
  }

  /**
   * Get default storage path with Electron detection
   */
  private getDefaultPath(): string {
    // ELECTRON DETECTION
    if (
      typeof process !== 'undefined' &&
      process.versions?.electron &&
      (process as any).type === 'browser' // Main process only
    ) {
      try {
        // Dynamic require prevents errors in non-Electron environments
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require('electron')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('path')
        return path.join(app.getPath('userData'), '.vultisig')
      } catch (error) {
        console.warn('Failed to get Electron userData path:', error)
        // Fall through to default
      }
    }

    // Default to home directory
    // Dynamic require prevents bundler errors in browser builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')
    return path.join(os.homedir(), '.vultisig')
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureDirectory(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise
    }

    this.initPromise = (async () => {
      try {
        const fs = await import('fs/promises')
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const path = require('path')

        // Create base directory
        await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 })

        // Create cache subdirectory
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

  /**
   * Get file path for a key
   */
  private getFilePath(key: string): string {
    // Sanitize key to prevent directory traversal - only block path separators
    const sanitized = key.replace(/[/\\]/g, '_')
    // Dynamic require prevents bundler errors in browser builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('path')

    // Put cache files in cache subdirectory for cleaner organization
    if (key.includes(':cache:')) {
      return path.join(this.basePath, 'cache', `${sanitized}.json`)
    }

    return path.join(this.basePath, `${sanitized}.json`)
  }

  async get<T>(key: string): Promise<T | null> {
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      const filePath = this.getFilePath(key)

      // Check if file exists
      try {
        await fs.access(filePath)
      } catch {
        return null // File doesn't exist
      }

      const content = await fs.readFile(filePath, 'utf-8')
      const stored = JSON.parse(content) as StoredValue<T>

      return stored.value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }

      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to read value for key "${key}"`,
        error as Error
      )
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
      const fs = await import('fs/promises')
      const filePath = this.getFilePath(key)
      const tempPath = `${filePath}.tmp`

      // Atomic write: write to temp file, then rename
      await fs.writeFile(tempPath, JSON.stringify(stored, null, 2), {
        encoding: 'utf-8',
        mode: 0o600, // Owner read/write only
      })

      // Atomic rename (overwrites existing file)
      await fs.rename(tempPath, filePath)
    } catch (error) {
      // Check for disk full
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') {
        throw new StorageError(
          StorageErrorCode.QuotaExceeded,
          'Disk space quota exceeded',
          error as Error
        )
      }

      throw new StorageError(
        StorageErrorCode.Unknown,
        `Failed to write value for key "${key}"`,
        error as Error
      )
    }
  }

  async remove(key: string): Promise<void> {
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      const filePath = this.getFilePath(key)

      // Check if file exists before attempting to delete
      try {
        await fs.access(filePath)
        await fs.unlink(filePath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
        // File doesn't exist - that's ok
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
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path')

      const keys: string[] = []

      // List files from base directory
      const files = await fs.readdir(this.basePath)
      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.tmp')) {
          // Remove .json extension to get key
          const key = file.slice(0, -5)
          keys.push(key)
        }
      }

      // List files from cache subdirectory
      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        for (const file of cacheFiles) {
          if (file.endsWith('.json') && !file.endsWith('.tmp')) {
            // Remove .json extension to get key
            const key = file.slice(0, -5)
            keys.push(key)
          }
        }
      } catch (error) {
        // Cache directory might not exist yet, that's ok
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
      }

      return keys
    } catch (error) {
      throw new StorageError(
        StorageErrorCode.Unknown,
        'Failed to list keys',
        error as Error
      )
    }
  }

  async clear(): Promise<void> {
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      // Dynamic require prevents bundler errors in browser builds
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path')

      // Remove all .json files from base directory
      const files = await fs.readdir(this.basePath)
      await Promise.all(
        files
          .filter(file => file.endsWith('.json'))
          .map(file => fs.unlink(path.join(this.basePath, file)))
      )

      // Remove all .json files from cache directory
      try {
        const cacheDir = path.join(this.basePath, 'cache')
        const cacheFiles = await fs.readdir(cacheDir)
        await Promise.all(
          cacheFiles
            .filter(file => file.endsWith('.json'))
            .map(file => fs.unlink(path.join(cacheDir, file)))
        )
      } catch (error) {
        // Cache directory might not exist, that's ok
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error
        }
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
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      // Dynamic require prevents bundler errors in browser builds
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path')

      let totalSize = 0

      // Calculate size of files in base directory
      const files = await fs.readdir(this.basePath)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.basePath, file)
          const stats = await fs.stat(filePath)
          totalSize += stats.size
        }
      }

      // Calculate size of files in cache directory
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
        // Cache directory might not exist, that's ok
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
    // Filesystem quota is typically not directly accessible
    // Could potentially use statvfs on Unix systems, but not portable
    return undefined
  }

  /**
   * Get metadata for a stored value
   */
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    await this.ensureDirectory()

    try {
      const fs = await import('fs/promises')
      const filePath = this.getFilePath(key)

      const content = await fs.readFile(filePath, 'utf-8')
      const stored = JSON.parse(content) as StoredValue

      return stored.metadata
    } catch {
      return null
    }
  }
}

// Self-register
import { type StorageOptions, storageRegistry } from './registry'

storageRegistry.register({
  name: 'node',
  priority: 100,
  isSupported: () => {
    return (
      typeof process !== 'undefined' &&
      process.versions?.node !== undefined &&
      typeof window === 'undefined' // Not Electron renderer
    )
  },
  create: (options?: StorageOptions) => {
    return new NodeStorage(
      options?.basePath ? { basePath: options.basePath } : undefined
    )
  },
})
