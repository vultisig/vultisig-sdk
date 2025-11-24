/**
 * Storage Test Utilities
 *
 * Helper functions, factories, and utilities for testing storage implementations.
 * Used across all storage backend tests and integration tests.
 */

import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

import { BrowserStorage } from '@/runtime/storage/BrowserStorage'
import { ChromeStorage } from '@/runtime/storage/ChromeStorage'
import { MemoryStorage } from '@/runtime/storage/MemoryStorage'
import { NodeStorage } from '@/runtime/storage/NodeStorage'
import type { Storage } from '@/runtime/storage/types'
import { StorageError, StorageErrorCode } from '@/runtime/storage/types'

/**
 * Storage type for factory
 */
export type StorageType = 'memory' | 'browser' | 'node' | 'chrome'

/**
 * Options for creating test storage
 */
export type CreateTestStorageOptions = {
  /**
   * Custom base path for NodeStorage
   */
  basePath?: string
  /**
   * Whether to auto-initialize storage (for BrowserStorage)
   */
  autoInit?: boolean
}

/**
 * Create a test storage instance of the specified type
 */
export async function createTestStorage(type: StorageType, options?: CreateTestStorageOptions): Promise<Storage> {
  switch (type) {
    case 'memory':
      return new MemoryStorage()

    case 'browser': {
      const storage = new BrowserStorage()
      if (options?.autoInit !== false) {
        await (storage as any).init?.()
      }
      return storage
    }

    case 'node':
      return new NodeStorage({ basePath: options?.basePath })

    case 'chrome':
      return new ChromeStorage()

    default:
      throw new Error(`Unknown storage type: ${type}`)
  }
}

/**
 * Assertion helpers
 */
export const storageAssertions = {
  /**
   * Assert that a value is stored correctly
   */
  async expectStoredValue<T>(storage: Storage, key: string, expected: T): Promise<void> {
    const actual = await storage.get<T>(key)
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `Expected key "${key}" to have value ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`
      )
    }
  },

  /**
   * Assert that storage contains exactly the expected keys
   */
  async expectStorageKeys(storage: Storage, expected: string[]): Promise<void> {
    const actual = await storage.list()
    const sortedActual = [...actual].sort()
    const sortedExpected = [...expected].sort()

    if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
      throw new Error(
        `Expected storage to have keys ${JSON.stringify(sortedExpected)}, but got ${JSON.stringify(sortedActual)}`
      )
    }
  },

  /**
   * Assert that storage is empty
   */
  async expectStorageEmpty(storage: Storage): Promise<void> {
    const keys = await storage.list()
    if (keys.length > 0) {
      throw new Error(`Expected storage to be empty, but found ${keys.length} keys: ${JSON.stringify(keys)}`)
    }
  },

  /**
   * Assert that a key does not exist
   */
  async expectKeyNotFound(storage: Storage, key: string): Promise<void> {
    const value = await storage.get(key)
    if (value !== null) {
      throw new Error(`Expected key "${key}" to not exist, but found value: ${JSON.stringify(value)}`)
    }
  },

  /**
   * Assert that storage usage is within expected range
   */
  async expectUsageInRange(storage: Storage, min: number, max: number): Promise<void> {
    const usage = await storage.getUsage?.()
    if (usage === undefined) {
      throw new Error('Storage does not support usage tracking')
    }
    if (usage < min || usage > max) {
      throw new Error(`Expected usage to be between ${min} and ${max}, but got ${usage}`)
    }
  },
}

/**
 * Cross-session persistence test helper
 *
 * Tests that data persists across storage instance restarts.
 *
 * @example
 * await testPersistence(
 *   async (storage) => {
 *     await storage.set('key', 'value')
 *   },
 *   async (storage) => {
 *     expect(await storage.get('key')).toBe('value')
 *   },
 *   'memory'
 * )
 */
export async function testPersistence<T>(
  setup: (storage: Storage) => Promise<T>,
  verify: (storage: Storage, setupResult: T) => Promise<void>,
  storageType: StorageType,
  options?: CreateTestStorageOptions
): Promise<void> {
  // Create first instance and run setup
  const storage1 = await createTestStorage(storageType, options)
  const setupResult = await setup(storage1)

  // Create second instance (simulates restart) and verify
  const storage2 = await createTestStorage(storageType, options)
  await verify(storage2, setupResult)

  // Cleanup
  await storage1.clear()
  await storage2.clear()
}

/**
 * Mock storage that fails with specific errors
 */
export class FailingStorage implements Storage {
  constructor(private errorCode: StorageErrorCode = StorageErrorCode.Unknown) {}

  async get<T>(key: string): Promise<T | null> {
    throw new StorageError(this.errorCode, `Failed to get key: ${key}`)
  }

  async set<T>(key: string, _value: T): Promise<void> {
    throw new StorageError(this.errorCode, `Failed to set key: ${key}`)
  }

  async remove(key: string): Promise<void> {
    throw new StorageError(this.errorCode, `Failed to remove key: ${key}`)
  }

  async list(): Promise<string[]> {
    throw new StorageError(this.errorCode, 'Failed to list keys')
  }

  async clear(): Promise<void> {
    throw new StorageError(this.errorCode, 'Failed to clear storage')
  }

  async getUsage(): Promise<number> {
    throw new StorageError(this.errorCode, 'Failed to get usage')
  }

  async getQuota(): Promise<number | undefined> {
    throw new StorageError(this.errorCode, 'Failed to get quota')
  }
}

/**
 * Create a failing storage instance
 */
export function createFailingStorage(errorCode: StorageErrorCode = StorageErrorCode.Unknown): Storage {
  return new FailingStorage(errorCode)
}

/**
 * Mock storage that simulates quota exceeded
 */
export class QuotaExceededStorage implements Storage {
  private data: Map<string, any> = new Map()
  private quota = 1024 * 100 // 100KB quota

  async get<T>(key: string): Promise<T | null> {
    return this.data.get(key) ?? null
  }

  async set<T>(key: string, value: T): Promise<void> {
    const currentUsage = await this.getUsage()
    const valueSize = JSON.stringify(value).length

    if (currentUsage + valueSize > this.quota) {
      throw new StorageError(
        StorageErrorCode.QuotaExceeded,
        `Quota exceeded: ${currentUsage + valueSize} > ${this.quota}`
      )
    }

    this.data.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.data.delete(key)
  }

  async list(): Promise<string[]> {
    return Array.from(this.data.keys())
  }

  async clear(): Promise<void> {
    this.data.clear()
  }

  async getUsage(): Promise<number> {
    let total = 0
    for (const [key, value] of this.data.entries()) {
      total += key.length + JSON.stringify(value).length
    }
    return total
  }

  async getQuota(): Promise<number> {
    return this.quota
  }

  setQuota(quota: number): void {
    this.quota = quota
  }
}

/**
 * Create a quota-exceeded storage instance
 */
export function createQuotaExceededStorage(quota = 1024 * 100): QuotaExceededStorage {
  const storage = new QuotaExceededStorage()
  storage.setQuota(quota)
  return storage
}

/**
 * Temporary directory helper for NodeStorage tests
 */
export class TempDirectory {
  private path: string | null = null

  /**
   * Create a temporary directory
   */
  async create(prefix = 'vultisig-test-'): Promise<string> {
    this.path = await mkdtemp(join(tmpdir(), prefix))
    return this.path
  }

  /**
   * Get the temporary directory path
   */
  getPath(): string {
    if (!this.path) {
      throw new Error('Temporary directory not created yet')
    }
    return this.path
  }

  /**
   * Cleanup the temporary directory
   */
  async cleanup(): Promise<void> {
    if (this.path) {
      await rm(this.path, { recursive: true, force: true })
      this.path = null
    }
  }
}

/**
 * Helper to test with temporary directory
 *
 * @example
 * await withTempDir(async (tempDir) => {
 *   const storage = new NodeStorage({ basePath: tempDir })
 *   await storage.set('key', 'value')
 * })
 */
export async function withTempDir<T>(fn: (tempDir: string) => Promise<T>, prefix = 'vultisig-test-'): Promise<T> {
  const tempDir = new TempDirectory()
  try {
    const path = await tempDir.create(prefix)
    return await fn(path)
  } finally {
    await tempDir.cleanup()
  }
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await condition()) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  throw new Error(`Condition not met within ${timeout}ms`)
}

/**
 * Test data generators
 */
export const testData = {
  /**
   * Generate a random string
   */
  randomString(length = 10): string {
    return Math.random()
      .toString(36)
      .substring(2, 2 + length)
  },

  /**
   * Generate a random object
   */
  randomObject(): Record<string, any> {
    return {
      id: testData.randomString(),
      name: `Test-${testData.randomString()}`,
      timestamp: Date.now(),
      nested: {
        value: Math.random(),
      },
    }
  },

  /**
   * Generate a large string (for quota testing)
   */
  largeString(sizeInKB = 10): string {
    const size = sizeInKB * 1024
    return 'x'.repeat(size)
  },

  /**
   * Generate test data with special characters
   */
  specialCharsData(): Record<string, string> {
    return {
      unicode: '你好世界 🌍',
      emoji: '🔑🔐🗝️',
      newlines: 'line1\nline2\nline3',
      quotes: 'He said "hello"',
      backslash: 'path\\to\\file',
      null: 'null\x00char',
    }
  },
}

/**
 * Storage contract tests
 *
 * Run a standard set of tests against any VaultStorage implementation
 * to ensure it meets the contract.
 */
export const storageContractTests = {
  /**
   * Run all contract tests against a storage instance
   */
  async testContract(createStorage: () => Promise<Storage>): Promise<void> {
    const tests = [
      storageContractTests.testBasicOperations,
      storageContractTests.testDataTypes,
      storageContractTests.testListAndClear,
      storageContractTests.testMetadata,
    ]

    for (const test of tests) {
      const storage = await createStorage()
      try {
        await test(storage)
      } finally {
        await storage.clear()
      }
    }
  },

  /**
   * Test basic get/set/remove operations
   */
  async testBasicOperations(storage: Storage): Promise<void> {
    // Set and get
    await storage.set('test-key', 'test-value')
    const value = await storage.get<string>('test-key')
    if (value !== 'test-value') {
      throw new Error('Basic set/get failed')
    }

    // Remove
    await storage.remove('test-key')
    const removed = await storage.get('test-key')
    if (removed !== null) {
      throw new Error('Remove failed')
    }
  },

  /**
   * Test different data types
   */
  async testDataTypes(storage: Storage): Promise<void> {
    const testCases: [string, any][] = [
      ['string', 'test'],
      ['number', 123],
      ['boolean', true],
      ['null', null],
      ['array', [1, 2, 3]],
      ['object', { foo: 'bar' }],
    ]

    for (const [key, value] of testCases) {
      await storage.set(key, value)
      const retrieved = await storage.get(key)
      if (JSON.stringify(retrieved) !== JSON.stringify(value)) {
        throw new Error(`Data type test failed for ${key}`)
      }
    }
  },

  /**
   * Test list and clear operations
   */
  async testListAndClear(storage: Storage): Promise<void> {
    // Add multiple keys
    await storage.set('key1', 'value1')
    await storage.set('key2', 'value2')
    await storage.set('key3', 'value3')

    // List
    const keys = await storage.list()
    if (keys.length !== 3) {
      throw new Error('List failed')
    }

    // Clear
    await storage.clear()
    const keysAfterClear = await storage.list()
    if (keysAfterClear.length !== 0) {
      throw new Error('Clear failed')
    }
  },

  /**
   * Test metadata tracking (if supported)
   */
  async testMetadata(storage: Storage): Promise<void> {
    await storage.set('test', 'value')

    // Optional: test getUsage and getQuota
    if (storage.getUsage) {
      const usage = await storage.getUsage()
      if (typeof usage !== 'number' || usage < 0) {
        throw new Error('Invalid usage value')
      }
    }
  },
}
