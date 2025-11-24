import { afterEach, describe, expect, it, vi } from 'vitest'

import { WasmManager } from '../../../src/runtime/wasm'

describe('WasmManager (static)', () => {
  afterEach(() => {
    WasmManager.reset()
  })

  describe('configuration', () => {
    it('should accept configuration', () => {
      expect(() => {
        WasmManager.configure({ autoInit: true })
      }).not.toThrow()
    })

    it('should warn if configured after initialization', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await WasmManager.getWalletCore()
      WasmManager.configure({ autoInit: true })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already initialized'))

      consoleSpy.mockRestore()
    })

    it('should accept custom wasm paths', () => {
      expect(() => {
        WasmManager.configure({
          wasmPaths: {
            dkls: '/custom/path/vs_wasm.wasm',
            schnorr: '/custom/path/vs_schnorr.wasm',
          },
        })
      }).not.toThrow()
    })
  })

  describe('initialization status', () => {
    it('should report uninitialized state initially', () => {
      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(false)
      expect(status.dkls).toBe(false)
      expect(status.schnorr).toBe(false)
    })

    it('should update status after wallet core initialization', async () => {
      await WasmManager.getWalletCore()

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
    })

    it('should update status after dkls initialization', async () => {
      await WasmManager.initializeDkls()

      const status = WasmManager.getStatus()
      expect(status.dkls).toBe(true)
    })

    it('should update status after schnorr initialization', async () => {
      await WasmManager.initializeSchnorr()

      const status = WasmManager.getStatus()
      expect(status.schnorr).toBe(true)
    })

    it('should update all status after full initialization', async () => {
      await WasmManager.initialize()

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(true)
      expect(status.schnorr).toBe(true)
    })
  })

  describe('lazy loading', () => {
    it('should not load modules until requested', () => {
      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(false)
      expect(status.dkls).toBe(false)
      expect(status.schnorr).toBe(false)
    })

    it('should load walletCore on demand', async () => {
      const walletCore = await WasmManager.getWalletCore()
      expect(walletCore).toBeTruthy()

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
    })

    it('should cache loaded wallet core', async () => {
      const wc1 = await WasmManager.getWalletCore()
      const wc2 = await WasmManager.getWalletCore()
      expect(wc1).toBe(wc2)
    })

    it('should not reload dkls if already initialized', async () => {
      await WasmManager.initializeDkls()
      const status1 = WasmManager.getStatus()

      await WasmManager.initializeDkls()
      const status2 = WasmManager.getStatus()

      expect(status1.dkls).toBe(true)
      expect(status2.dkls).toBe(true)
    })

    it('should not reload schnorr if already initialized', async () => {
      await WasmManager.initializeSchnorr()
      const status1 = WasmManager.getStatus()

      await WasmManager.initializeSchnorr()
      const status2 = WasmManager.getStatus()

      expect(status1.schnorr).toBe(true)
      expect(status2.schnorr).toBe(true)
    })
  })

  describe('parallel initialization', () => {
    it('should handle concurrent wallet core requests without race conditions', async () => {
      // Call 10 times concurrently - memoizeAsync prevents race conditions
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => WasmManager.getWalletCore())
      )

      // All should return the same instance (first call initializes, rest wait)
      const first = results[0]
      for (const result of results) {
        expect(result).toBe(first)
      }
    })

    it('should handle concurrent DKLS initialization', async () => {
      // Call 5 times concurrently
      await Promise.all(
        Array(5)
          .fill(null)
          .map(() => WasmManager.initializeDkls())
      )

      // Should be initialized
      const status = WasmManager.getStatus()
      expect(status.dkls).toBe(true)
    })

    it('should handle concurrent full initialization', async () => {
      // Call 3 times concurrently
      await Promise.all([WasmManager.initialize(), WasmManager.initialize(), WasmManager.initialize()])

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(true)
      expect(status.schnorr).toBe(true)
    })
  })

  describe('reset functionality', () => {
    it('should reset all state', async () => {
      await WasmManager.initialize()
      let status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)

      WasmManager.reset()
      status = WasmManager.getStatus()
      expect(status.walletCore).toBe(false)
      expect(status.dkls).toBe(false)
      expect(status.schnorr).toBe(false)
    })

    it('should allow re-initialization after reset', async () => {
      await WasmManager.getWalletCore()
      WasmManager.reset()

      await WasmManager.getWalletCore()
      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should provide meaningful error messages on invalid path', async () => {
      // Configure with invalid path
      WasmManager.configure({
        wasmPaths: {
          dkls: '/nonexistent/path/invalid.wasm',
        },
      })

      await expect(WasmManager.initializeDkls()).rejects.toThrow(/Failed to initialize DKLS WASM/)
    })
  })

  describe('initialization methods', () => {
    it('should initialize all modules with initialize()', async () => {
      await WasmManager.initialize()

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(true)
      expect(status.schnorr).toBe(true)
    })

    it('should be idempotent - calling initialize() multiple times', async () => {
      await WasmManager.initialize()
      await WasmManager.initialize()
      await WasmManager.initialize()

      const status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(true)
      expect(status.schnorr).toBe(true)
    })

    it('should allow selective initialization', async () => {
      // Only initialize wallet core
      await WasmManager.getWalletCore()

      let status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(false)
      expect(status.schnorr).toBe(false)

      // Then initialize dkls
      await WasmManager.initializeDkls()

      status = WasmManager.getStatus()
      expect(status.walletCore).toBe(true)
      expect(status.dkls).toBe(true)
      expect(status.schnorr).toBe(false)
    })
  })
})
