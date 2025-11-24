// Import polyfill providers to trigger self-registration
import '../../../src/runtime/polyfills/BrowserPolyfillProvider'
import '../../../src/runtime/polyfills/NodePolyfillProvider'

import { afterEach, describe, expect, it } from 'vitest'

import { PolyfillManager } from '../../../src/runtime/polyfills'
import { polyfillRegistry } from '../../../src/runtime/polyfills/registry'

describe('PolyfillManager', () => {
  afterEach(() => {
    PolyfillManager.reset()
  })

  describe('initialization', () => {
    it('should start uninitialized', () => {
      expect(PolyfillManager.isInitialized()).toBe(false)
    })

    it('should initialize successfully', async () => {
      await PolyfillManager.initialize()
      expect(PolyfillManager.isInitialized()).toBe(true)
    })

    it('should be idempotent - calling initialize() multiple times', async () => {
      await PolyfillManager.initialize()
      await PolyfillManager.initialize()
      await PolyfillManager.initialize()

      expect(PolyfillManager.isInitialized()).toBe(true)
    })

    it('should reset state', () => {
      PolyfillManager.reset()
      expect(PolyfillManager.isInitialized()).toBe(false)
    })

    it('should allow re-initialization after reset', async () => {
      await PolyfillManager.initialize()
      expect(PolyfillManager.isInitialized()).toBe(true)

      PolyfillManager.reset()
      expect(PolyfillManager.isInitialized()).toBe(false)

      await PolyfillManager.initialize()
      expect(PolyfillManager.isInitialized()).toBe(true)
    })
  })

  describe('provider detection', () => {
    it('should detect supported providers', () => {
      const providers = PolyfillManager.getSupportedProviders()
      expect(Array.isArray(providers)).toBe(true)
      expect(providers.length).toBeGreaterThan(0)
    })

    it('should have at least one supported provider', () => {
      const providers = PolyfillManager.getSupportedProviders()
      expect(providers.length).toBeGreaterThan(0)
    })

    it('supported providers should be from registered providers', () => {
      const supported = PolyfillManager.getSupportedProviders()
      const all = polyfillRegistry.getAllProviders().map(p => p.name)

      for (const name of supported) {
        expect(all).toContain(name)
      }
    })
  })

  describe('polyfill registry integration', () => {
    it('should have providers registered', () => {
      const providers = polyfillRegistry.getAllProviders()
      expect(providers.length).toBeGreaterThan(0)
    })

    it('should have node and browser providers', () => {
      const names = polyfillRegistry.getAllProviders().map(p => p.name)
      expect(names).toContain('node')
      expect(names).toContain('browser')
    })

    it('providers should have correct priority', () => {
      const providers = polyfillRegistry.getAllProviders()
      const priorityMap = new Map(providers.map(p => [p.name, p.priority]))

      expect(priorityMap.get('node')).toBe(100)
      expect(priorityMap.get('browser')).toBe(90)
    })

    it('providers should be sorted by priority', () => {
      const providers = polyfillRegistry.getAllProviders()

      for (let i = 0; i < providers.length - 1; i++) {
        expect(providers[i].priority).toBeGreaterThanOrEqual(providers[i + 1].priority)
      }
    })
  })

  describe('provider properties', () => {
    it('each provider should have required properties', () => {
      const providers = polyfillRegistry.getAllProviders()

      for (const provider of providers) {
        expect(provider.name).toBeTruthy()
        expect(typeof provider.name).toBe('string')
        expect(typeof provider.priority).toBe('number')
        expect(typeof provider.isSupported).toBe('function')
        expect(typeof provider.initialize).toBe('function')
      }
    })

    it('each provider should have unique name', () => {
      const providers = polyfillRegistry.getAllProviders()
      const names = providers.map(p => p.name)
      const uniqueNames = new Set(names)

      expect(uniqueNames.size).toBe(names.length)
    })
  })

  describe('error handling', () => {
    it('should not throw on initialization failures', async () => {
      // Polyfills are best-effort, failures should be logged but not throw
      await expect(PolyfillManager.initialize()).resolves.not.toThrow()
    })
  })

  describe('concurrent initialization', () => {
    it('should handle concurrent initialization calls', async () => {
      await Promise.all([PolyfillManager.initialize(), PolyfillManager.initialize(), PolyfillManager.initialize()])

      expect(PolyfillManager.isInitialized()).toBe(true)
    })
  })
})
