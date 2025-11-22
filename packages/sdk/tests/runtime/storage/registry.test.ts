// Import storage implementations to trigger self-registration
import '../../../src/runtime/storage/BrowserStorage'
import '../../../src/runtime/storage/ChromeStorage'
import '../../../src/runtime/storage/NodeStorage'
import '../../../src/runtime/storage/MemoryStorage'

import { describe, expect, it } from 'vitest'

import { storageRegistry } from '../../../src/runtime/storage/registry'

describe('StorageProviderRegistry', () => {
  describe('provider registration', () => {
    it('should register providers with priority sorting', () => {
      const providers = storageRegistry.getAllProviders()

      // Should be sorted by priority descending
      for (let i = 0; i < providers.length - 1; i++) {
        expect(providers[i].priority).toBeGreaterThanOrEqual(
          providers[i + 1].priority
        )
      }
    })

    it('should have all expected providers registered', () => {
      const providers = storageRegistry.getAllProviders()
      const names = providers.map(p => p.name)

      expect(names).toContain('browser')
      expect(names).toContain('chrome')
      expect(names).toContain('node')
      expect(names).toContain('memory')
    })

    it('should have correct priority order', () => {
      const providers = storageRegistry.getAllProviders()
      const priorityMap = new Map(providers.map(p => [p.name, p.priority]))

      // Chrome should have higher priority than browser
      expect(priorityMap.get('chrome')).toBeGreaterThan(
        priorityMap.get('browser') ?? 0
      )

      // Memory should have lowest priority (fallback)
      expect(priorityMap.get('memory')).toBe(0)
    })
  })

  describe('provider selection', () => {
    it('should select a supported provider', () => {
      const provider = storageRegistry.findBestProvider()
      expect(provider).toBeTruthy()
      expect(provider?.isSupported()).toBe(true)
    })

    it('should select highest priority provider that is supported', () => {
      const supportedProviders = storageRegistry
        .getAllProviders()
        .filter(p => p.isSupported())

      if (supportedProviders.length > 0) {
        const best = storageRegistry.findBestProvider()
        expect(best).toBe(supportedProviders[0]) // First in sorted list
      }
    })

    it('should have at least memory storage available (fallback)', () => {
      const provider = storageRegistry.findBestProvider()
      expect(provider).toBeTruthy()
      // Memory storage should always be supported
      const memoryProvider = storageRegistry
        .getAllProviders()
        .find(p => p.name === 'memory')
      expect(memoryProvider?.isSupported()).toBe(true)
    })
  })

  describe('storage creation', () => {
    it('should create storage using best provider', () => {
      const storage = storageRegistry.createStorage()
      expect(storage).toBeTruthy()
      expect(storage.get).toBeDefined()
      expect(storage.set).toBeDefined()
      expect(storage.remove).toBeDefined()
      expect(storage.clear).toBeDefined()
    })

    it('should create specific storage type when requested', () => {
      const storage = storageRegistry.createStorage({ type: 'memory' })
      expect(storage).toBeTruthy()
    })

    it('should throw error for unknown storage type', () => {
      expect(() => {
        storageRegistry.createStorage({ type: 'unknown' as any })
      }).toThrow('Storage provider "unknown" not found')
    })

    it('should use custom storage when provided', async () => {
      const customStorage = {
        get: async () => null,
        set: async () => {},
        remove: async () => {},
        clear: async () => {},
      }

      const storage = storageRegistry.createStorage({
        customStorage,
      })

      expect(storage).toBe(customStorage)
    })

    it('should support basePath option for node storage', () => {
      // Only test if node storage is available
      const nodeProvider = storageRegistry
        .getAllProviders()
        .find(p => p.name === 'node')

      if (nodeProvider?.isSupported()) {
        const storage = storageRegistry.createStorage({
          type: 'node',
          basePath: '/tmp/test-vultisig',
        })
        expect(storage).toBeTruthy()
      }
    })
  })

  describe('provider capabilities', () => {
    it('each provider should have required properties', () => {
      const providers = storageRegistry.getAllProviders()

      for (const provider of providers) {
        expect(provider.name).toBeTruthy()
        expect(typeof provider.name).toBe('string')
        expect(typeof provider.priority).toBe('number')
        expect(typeof provider.isSupported).toBe('function')
        expect(typeof provider.create).toBe('function')
      }
    })

    it('memory provider should always be supported', () => {
      const memoryProvider = storageRegistry
        .getAllProviders()
        .find(p => p.name === 'memory')

      expect(memoryProvider).toBeDefined()
      expect(memoryProvider?.isSupported()).toBe(true)
    })

    it('should be able to create storage from each supported provider', () => {
      const supportedProviders = storageRegistry
        .getAllProviders()
        .filter(p => p.isSupported())

      for (const provider of supportedProviders) {
        const storage = provider.create()
        expect(storage).toBeTruthy()
        expect(storage.get).toBeDefined()
        expect(storage.set).toBeDefined()
      }
    })
  })
})
