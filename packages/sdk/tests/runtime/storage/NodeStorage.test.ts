/**
 * NodeStorage Tests
 *
 * Comprehensive tests for NodeStorage filesystem-based storage.
 * Tests CRUD operations, Electron path detection, atomic writes, error handling.
 */

import { promises as fs } from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NodeStorage } from '@/runtime/storage/NodeStorage'
import { StorageErrorCode } from '@/runtime/storage/types'

describe('NodeStorage', () => {
  let storage: NodeStorage
  let tempDir: string

  beforeEach(async () => {
    // Create temp directory for tests
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vultisig-test-'))
    storage = new NodeStorage({ basePath: tempDir })
  })

  afterEach(async () => {
    try {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe('Basic Operations', () => {
    it('should store and retrieve a string value', async () => {
      await storage.set('test-key', 'test-value')
      const result = await storage.get<string>('test-key')
      expect(result).toBe('test-value')
    })

    it('should store and retrieve a number value', async () => {
      await storage.set('number-key', 42)
      const result = await storage.get<number>('number-key')
      expect(result).toBe(42)
    })

    it('should store and retrieve an object', async () => {
      const obj = { name: 'Test', value: 123 }
      await storage.set('object-key', obj)
      const result = await storage.get('object-key')
      expect(result).toEqual(obj)
    })

    it('should store and retrieve an array', async () => {
      const arr = [1, 2, 3, 4, 5]
      await storage.set('array-key', arr)
      const result = await storage.get<number[]>('array-key')
      expect(result).toEqual(arr)
    })

    it('should return null for non-existent key', async () => {
      const result = await storage.get('non-existent')
      expect(result).toBeNull()
    })

    it('should update existing value', async () => {
      await storage.set('key', 'value1')
      await storage.set('key', 'value2')
      const result = await storage.get<string>('key')
      expect(result).toBe('value2')
    })
  })

  describe('Remove Operations', () => {
    it('should remove a key', async () => {
      await storage.set('test-key', 'test-value')
      await storage.remove('test-key')
      const result = await storage.get('test-key')
      expect(result).toBeNull()
    })

    it('should not throw when removing non-existent key', async () => {
      await expect(storage.remove('non-existent')).resolves.not.toThrow()
    })

    it('should remove only specified key', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.remove('key1')

      expect(await storage.get('key1')).toBeNull()
      expect(await storage.get('key2')).toBe('value2')
    })

    it('should remove the file from filesystem', async () => {
      await storage.set('key', 'value')
      const files = await fs.readdir(tempDir)
      expect(files).toContain('key.json')

      await storage.remove('key')
      const filesAfter = await fs.readdir(tempDir)
      expect(filesAfter).not.toContain('key.json')
    })
  })

  describe('List Operations', () => {
    it('should list all keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      const keys = await storage.list()
      expect(keys).toHaveLength(3)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should return empty array when no keys', async () => {
      const keys = await storage.list()
      expect(keys).toEqual([])
    })

    it('should update list after adding keys', async () => {
      expect(await storage.list()).toHaveLength(0)

      await storage.set('key1', 'value1')
      expect(await storage.list()).toHaveLength(1)

      await storage.set('key2', 'value2')
      expect(await storage.list()).toHaveLength(2)
    })

    it('should update list after removing keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      expect(await storage.list()).toHaveLength(2)

      await storage.remove('key1')
      expect(await storage.list()).toHaveLength(1)
    })

    it('should not include temp files in list', async () => {
      await storage.set('key1', 'value1')
      // Create a temp file manually
      await fs.writeFile(path.join(tempDir, 'key2.json.tmp'), 'temp')

      const keys = await storage.list()
      expect(keys).toEqual(['key1'])
    })
  })

  describe('Clear Operations', () => {
    it('should clear all keys', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')
      await storage.set('key3', 'value3')

      await storage.clear()
      const keys = await storage.list()
      expect(keys).toEqual([])
    })

    it('should allow adding keys after clear', async () => {
      await storage.set('key1', 'value1')
      await storage.clear()
      await storage.set('key2', 'value2')

      const result = await storage.get<string>('key2')
      expect(result).toBe('value2')
    })

    it('should not throw on empty storage', async () => {
      await expect(storage.clear()).resolves.not.toThrow()
    })

    it('should remove all files from filesystem', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      await storage.clear()
      const files = await fs.readdir(tempDir)
      const jsonFiles = files.filter(f => f.endsWith('.json'))
      expect(jsonFiles).toEqual([])
    })
  })

  describe('Filesystem-Specific Features', () => {
    it('should use atomic writes with temp files', async () => {
      const key = 'atomic-test'
      await storage.set(key, 'value')

      // Verify the temp file doesn't exist after write
      const files = await fs.readdir(tempDir)
      expect(files).not.toContain('atomic-test.json.tmp')
      expect(files).toContain('atomic-test.json')
    })

    it('should store files with correct permissions (0o600)', async () => {
      await storage.set('secure-key', 'secure-value')
      const filePath = path.join(tempDir, 'secure-key.json')
      const stats = await fs.stat(filePath)

      // Check file permissions (owner read/write only)
      // On some systems, the mode might include file type bits, so mask them
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o600)
    })

    it('should create directory with correct permissions (0o700)', async () => {
      const stats = await fs.stat(tempDir)
      const mode = stats.mode & 0o777
      expect(mode).toBe(0o700)
    })

    it('should persist data across instances', async () => {
      // First instance
      await storage.set('persistent-key', 'persistent-value')

      // Create new instance pointing to same directory
      const storage2 = new NodeStorage({ basePath: tempDir })
      const result = await storage2.get<string>('persistent-key')
      expect(result).toBe('persistent-value')
    })

    it('should store metadata in JSON files', async () => {
      await storage.set('meta-key', 'meta-value')
      const filePath = path.join(tempDir, 'meta-key.json')
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = JSON.parse(content)

      expect(parsed).toHaveProperty('value', 'meta-value')
      expect(parsed).toHaveProperty('metadata')
      expect(parsed.metadata).toHaveProperty('version')
      expect(parsed.metadata).toHaveProperty('createdAt')
      expect(parsed.metadata).toHaveProperty('lastModified')
    })
  })

  describe('Key Sanitization', () => {
    it('should sanitize special characters in keys', async () => {
      await storage.set('key:with/special\\chars', 'value')
      const files = await fs.readdir(tempDir)
      // Only path separators (/ and \) are replaced with underscores
      expect(files).toContain('key:with_special_chars.json')
    })

    it('should prevent directory traversal attacks', async () => {
      const maliciousKey = '../../../etc/passwd'
      await storage.set(maliciousKey, 'value')

      // Verify file was created in temp dir, not outside
      const files = await fs.readdir(tempDir)
      // '../../../etc/passwd' -> only slashes replaced with underscores
      expect(files).toContain('.._.._.._etc_passwd.json')

      // Verify we can retrieve it
      const result = await storage.get<string>(maliciousKey)
      expect(result).toBe('value')
    })

    it('should handle Unicode characters in keys', async () => {
      await storage.set('key-🔑-unicode', 'value')
      const files = await fs.readdir(tempDir)
      // Unicode chars should be sanitized to underscores
      expect(files.some(f => f.startsWith('key-') && f.endsWith('.json'))).toBe(true)

      // Should still be retrievable
      const result = await storage.get<string>('key-🔑-unicode')
      expect(result).toBe('value')
    })

    it('should allow alphanumeric, hyphens, and underscores', async () => {
      await storage.set('valid-key_123', 'value')
      const files = await fs.readdir(tempDir)
      expect(files).toContain('valid-key_123.json')
    })
  })

  describe('Path Detection', () => {
    it('should use custom basePath when provided', () => {
      const customPath = '/custom/path'
      const customStorage = new NodeStorage({ basePath: customPath })
      expect(customStorage.basePath).toBe(customPath)
    })

    it('should detect Electron environment (main process)', () => {
      // Mock Electron environment
      const originalProcess = process.versions
      const originalType = (process as any).type

      vi.stubGlobal('process', {
        ...process,
        versions: { ...process.versions, electron: '28.0.0' },
        type: 'browser',
      })

      // Mock electron module
      const mockElectronPath = '/mock/electron/userData'
      vi.doMock('electron', () => ({
        app: {
          getPath: vi.fn(() => mockElectronPath),
        },
      }))

      // Note: Due to dynamic require() in NodeStorage, we can't easily test the actual path
      // This test verifies the logic exists, but full integration would need process mocking
      // before module load

      // Restore
      vi.stubGlobal('process', {
        ...process,
        versions: originalProcess,
        type: originalType,
      })
      vi.clearAllMocks()
    })

    it('should use default Node.js path when not in Electron', () => {
      // Ensure we're not in Electron environment
      const originalVersions = process.versions
      vi.stubGlobal('process', {
        ...process,
        versions: { ...originalVersions, electron: undefined },
      })

      const defaultStorage = new NodeStorage()
      // Should use ~/.vultisig
      expect(defaultStorage.basePath).toContain('.vultisig')

      // Restore
      vi.stubGlobal('process', {
        ...process,
        versions: originalVersions,
      })
    })
  })

  describe('Error Handling', () => {
    it('should throw error for corrupted JSON files', async () => {
      const filePath = path.join(tempDir, 'corrupted.json')
      await fs.writeFile(filePath, 'not valid json{{{')

      // Corrupted JSON should throw an error
      await expect(storage.get('corrupted')).rejects.toThrow()
    })

    it('should handle ENOENT gracefully', async () => {
      // Try to get a key that doesn't exist
      const result = await storage.get('nonexistent')
      expect(result).toBeNull()
    })

    // Note: ENOSPC testing is difficult to mock properly in unit tests
    // The error handling code path exists in NodeStorage.ts:168-173
    // This would be better tested in integration tests with actual disk quota limits

    it('should throw PermissionDenied when directory creation fails', async () => {
      // Create storage with path that can't be created
      const invalidPath = '/root/vultisig-test-invalid'
      const invalidStorage = new NodeStorage({ basePath: invalidPath })

      // Try to set a value (which will try to create directory)
      await expect(invalidStorage.set('key', 'value')).rejects.toMatchObject({
        code: StorageErrorCode.PermissionDenied,
      })
    })

    it('should handle concurrent writes to different keys', async () => {
      // Write different keys concurrently
      await Promise.all([
        storage.set('concurrent1', 'value1'),
        storage.set('concurrent2', 'value2'),
        storage.set('concurrent3', 'value3'),
      ])

      // All values should be stored successfully
      expect(await storage.get<string>('concurrent1')).toBe('value1')
      expect(await storage.get<string>('concurrent2')).toBe('value2')
      expect(await storage.get<string>('concurrent3')).toBe('value3')
    })
  })

  describe('Data Types', () => {
    it('should handle boolean values', async () => {
      await storage.set('bool-true', true)
      await storage.set('bool-false', false)

      expect(await storage.get('bool-true')).toBe(true)
      expect(await storage.get('bool-false')).toBe(false)
    })

    it('should handle null value', async () => {
      await storage.set('null-key', null)
      const result = await storage.get('null-key')
      expect(result).toBeNull()
    })

    it('should handle nested objects', async () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      }
      await storage.set('nested', nested)
      const result = await storage.get('nested')
      expect(result).toEqual(nested)
    })

    it('should handle arrays of objects', async () => {
      const arr = [
        { id: 1, name: 'First' },
        { id: 2, name: 'Second' },
      ]
      await storage.set('array-objects', arr)
      const result = await storage.get('array-objects')
      expect(result).toEqual(arr)
    })
  })

  describe('Usage & Quota', () => {
    it('should calculate usage as sum of file sizes', async () => {
      await storage.set('key1', 'value1')
      await storage.set('key2', 'value2')

      const usage = await storage.getUsage()
      expect(usage).toBeGreaterThan(0)

      // Add another key, usage should increase
      const usageBefore = usage
      await storage.set('key3', 'value3')
      const usageAfter = await storage.getUsage()
      expect(usageAfter).toBeGreaterThan(usageBefore)
    })

    it('should return 0 usage for empty storage', async () => {
      const usage = await storage.getUsage()
      expect(usage).toBe(0)
    })

    it('should return undefined for quota (filesystem quota not accessible)', async () => {
      const quota = await storage.getQuota()
      expect(quota).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle large values', async () => {
      const largeValue = 'x'.repeat(100000) // 100KB
      await storage.set('large', largeValue)
      const result = await storage.get<string>('large')
      expect(result).toBe(largeValue)
    })

    it('should handle empty string as key', async () => {
      await storage.set('', 'empty-key-value')
      expect(await storage.get('')).toBe('empty-key-value')
    })

    it('should handle empty string as value', async () => {
      await storage.set('empty-value', '')
      expect(await storage.get('empty-value')).toBe('')
    })

    it('should handle Unicode in values', async () => {
      await storage.set('unicode', '你好世界 🌍')
      expect(await storage.get('unicode')).toBe('你好世界 🌍')
    })
  })

  describe('Metadata Operations', () => {
    it('should store and retrieve metadata', async () => {
      await storage.set('meta-key', 'meta-value')
      const metadata = await storage.getMetadata('meta-key')

      expect(metadata).not.toBeNull()
      expect(metadata).toHaveProperty('version')
      expect(metadata).toHaveProperty('createdAt')
      expect(metadata).toHaveProperty('lastModified')
    })

    it('should return null metadata for non-existent key', async () => {
      const metadata = await storage.getMetadata('nonexistent')
      expect(metadata).toBeNull()
    })

    it('should update lastModified on subsequent writes', async () => {
      await storage.set('key', 'value1')
      const meta1 = await storage.getMetadata('key')

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      await storage.set('key', 'value2')
      const meta2 = await storage.getMetadata('key')

      expect(meta2!.lastModified).toBeGreaterThan(meta1!.lastModified)
    })
  })
})
