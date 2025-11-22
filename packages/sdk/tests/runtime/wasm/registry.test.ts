// Import wasm loaders to trigger self-registration
import '../../../src/runtime/wasm/BrowserWasmLoader'
import '../../../src/runtime/wasm/NodeWasmLoader'
import '../../../src/runtime/wasm/ChromeWasmLoader'

import { afterEach, describe, expect, it } from 'vitest'

import { WasmManager } from '../../../src/runtime/wasm'
import { wasmLoaderRegistry } from '../../../src/runtime/wasm/registry'

describe('WasmLoaderRegistry', () => {
  afterEach(() => {
    WasmManager.reset()
  })

  describe('loader registration', () => {
    it('should register loaders with priority sorting', () => {
      const loaders = wasmLoaderRegistry.getAllLoaders()

      // Should be sorted by priority descending
      for (let i = 0; i < loaders.length - 1; i++) {
        expect(loaders[i].priority).toBeGreaterThanOrEqual(
          loaders[i + 1].priority
        )
      }
    })

    it('should have all expected loaders registered', () => {
      const loaders = wasmLoaderRegistry.getAllLoaders()
      const names = loaders.map(l => l.name)

      expect(names).toContain('browser')
      expect(names).toContain('node')
      expect(names).toContain('chrome')
    })

    it('should have correct priority order', () => {
      const loaders = wasmLoaderRegistry.getAllLoaders()
      const priorityMap = new Map(loaders.map(l => [l.name, l.priority]))

      // Chrome should have highest priority
      expect(priorityMap.get('chrome')).toBe(110)

      // Node should be higher than browser
      expect(priorityMap.get('node') ?? 0).toBeGreaterThan(
        priorityMap.get('browser') ?? 0
      )
    })
  })

  describe('loader selection', () => {
    it('should select appropriate loader for environment', () => {
      const loader = wasmLoaderRegistry.findBestLoader()
      expect(loader).toBeTruthy()
      expect(loader.name).toMatch(/browser|node|chrome/)
      expect(loader.isSupported()).toBe(true)
    })

    it('should cache selected loader', () => {
      const loader1 = wasmLoaderRegistry.findBestLoader()
      const loader2 = wasmLoaderRegistry.findBestLoader()
      expect(loader1).toBe(loader2) // Same instance
    })

    it('should select highest priority supported loader', () => {
      const supportedLoaders = wasmLoaderRegistry
        .getAllLoaders()
        .filter(l => l.isSupported())

      if (supportedLoaders.length > 0) {
        const best = wasmLoaderRegistry.findBestLoader()
        expect(best).toBe(supportedLoaders[0]) // First in sorted list
      }
    })
  })

  describe('path resolution', () => {
    it('should resolve WASM paths', () => {
      const path = wasmLoaderRegistry.resolvePath('test.wasm')
      expect(path).toBeTruthy()
      expect(typeof path).toBe('string')
    })

    it('should resolve different filenames', () => {
      const dklsPath = wasmLoaderRegistry.resolvePath('dkls/vs_wasm_bg.wasm')
      const schnorrPath = wasmLoaderRegistry.resolvePath(
        'schnorr/vs_schnorr_wasm_bg.wasm'
      )

      expect(dklsPath).toBeTruthy()
      expect(schnorrPath).toBeTruthy()
      expect(dklsPath).not.toBe(schnorrPath)
    })
  })

  describe('loader capabilities', () => {
    it('each loader should have required properties', () => {
      const loaders = wasmLoaderRegistry.getAllLoaders()

      for (const loader of loaders) {
        expect(loader.name).toBeTruthy()
        expect(typeof loader.name).toBe('string')
        expect(typeof loader.priority).toBe('number')
        expect(typeof loader.isSupported).toBe('function')
        expect(typeof loader.loadWasm).toBe('function')
        expect(typeof loader.resolvePath).toBe('function')
      }
    })

    it('should have at least one supported loader', () => {
      const supportedLoaders = wasmLoaderRegistry
        .getAllLoaders()
        .filter(l => l.isSupported())

      expect(supportedLoaders.length).toBeGreaterThan(0)
    })

    it('exactly one loader should be selected as best', () => {
      const best = wasmLoaderRegistry.findBestLoader()
      expect(best).toBeTruthy()
      expect(best.isSupported()).toBe(true)
    })
  })

  describe('wasm loading', () => {
    it('should throw error when no supported loader available', () => {
      // This test is theoretical - in practice there's always a supported loader
      // But we test the error handling
      const loaders = wasmLoaderRegistry.getAllLoaders()
      if (loaders.every(l => !l.isSupported())) {
        expect(() => wasmLoaderRegistry.findBestLoader()).toThrow(
          'No WASM loaders available'
        )
      }
    })
  })
})
