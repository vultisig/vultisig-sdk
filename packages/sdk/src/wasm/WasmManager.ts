import { initWasm } from '@trustwallet/wallet-core'

import initializeDkls from '../../../lib/dkls/vs_wasm.js'
import initializeSchnorr from '../../../lib/schnorr/vs_schnorr_wasm.js'
import { memoizeAsync } from '../utils/memoizeAsync'
import type { WasmConfig } from './types'

/**
 * WasmManager handles initialization and management of all WASM modules.
 *
 * Static methods - no instance needed.
 * Supports lazy loading for optimal performance.
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading.
 *
 * Platform-specific implementations handle WASM loading.
 * Thread-safe: Uses memoizeAsync to prevent race conditions during concurrent initialization.
 */
export class WasmManager {
  private static config?: WasmConfig
  private static walletCoreInstance?: any
  private static dklsInitialized = false
  private static schnorrInitialized = false

  // Race-safe memoized initialization functions
  private static memoizedInitWalletCore = memoizeAsync(async () => {
    if (this.config?.wasmPaths?.walletCore) {
      console.warn('Custom WASM path for wallet-core is not supported. Using default path.')
    }
    const instance = await initWasm()
    this.walletCoreInstance = instance
    return instance
  })

  private static memoizedInitDkls = memoizeAsync(async () => {
    const wasmPath = this.config?.wasmPaths?.dkls

    // If wasmPath is a function, call it to get the ArrayBuffer
    if (typeof wasmPath === 'function') {
      const arrayBuffer = await wasmPath()
      await initializeDkls(arrayBuffer)
    }
    // If wasmPath is already an ArrayBuffer, use it directly
    else if (wasmPath instanceof ArrayBuffer) {
      await initializeDkls(wasmPath)
    }
    // Default: expect WASM modules to be available via default import
    // Platform-specific builds ensure WASM is accessible
    else {
      await initializeDkls()
    }

    this.dklsInitialized = true
  })

  private static memoizedInitSchnorr = memoizeAsync(async () => {
    const wasmPath = this.config?.wasmPaths?.schnorr

    // If wasmPath is a function, call it to get the ArrayBuffer
    if (typeof wasmPath === 'function') {
      const arrayBuffer = await wasmPath()
      await initializeSchnorr(arrayBuffer)
    }
    // If wasmPath is already an ArrayBuffer, use it directly
    else if (wasmPath instanceof ArrayBuffer) {
      await initializeSchnorr(wasmPath)
    }
    // Default: expect WASM modules to be available via default import
    // Platform-specific builds ensure WASM is accessible
    else {
      await initializeSchnorr()
    }

    this.schnorrInitialized = true
  })

  /**
   * Configure WASM loading (optional).
   * Must be called before any WASM modules are loaded.
   */
  static configure(config: WasmConfig): void {
    if (this.walletCoreInstance || this.dklsInitialized || this.schnorrInitialized) {
      console.warn('WASM modules already initialized, configuration may not take effect')
    }
    this.config = config
  }

  /**
   * Get WalletCore instance for address derivation and operations.
   * Lazy loads on first access.
   * Thread-safe: Concurrent calls will wait for same initialization promise.
   */
  static async getWalletCore() {
    try {
      if (this.walletCoreInstance) {
        return this.walletCoreInstance
      }

      return await this.memoizedInitWalletCore()
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`)
    }
  }

  /**
   * Initialize DKLS WASM module (ECDSA).
   * Lazy loads on first access.
   * Supports custom paths and environment-specific loading.
   * Thread-safe: Concurrent calls will wait for same initialization promise.
   */
  static async initializeDkls(): Promise<void> {
    try {
      if (this.dklsInitialized) {
        return
      }

      await this.memoizedInitDkls()
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA).
   * Lazy loads on first access.
   * Supports custom paths and environment-specific loading.
   * Thread-safe: Concurrent calls will wait for same initialization promise.
   */
  static async initializeSchnorr(): Promise<void> {
    try {
      if (this.schnorrInitialized) {
        return
      }

      await this.memoizedInitSchnorr()
    } catch (error) {
      throw new Error(`Failed to initialize Schnorr WASM: ${error}`)
    }
  }

  /**
   * Pre-load all WASM modules (optional).
   * Useful for upfront initialization to avoid delays later.
   */
  static async initialize(): Promise<void> {
    try {
      // Initialize in parallel for better performance
      await Promise.all([this.getWalletCore(), this.initializeDkls(), this.initializeSchnorr()])
    } catch (error) {
      throw new Error(`Failed to initialize WASM modules: ${error}`)
    }
  }

  /**
   * Get initialization status for all modules.
   */
  static getStatus() {
    return {
      walletCore: this.walletCoreInstance !== undefined,
      dkls: this.dklsInitialized,
      schnorr: this.schnorrInitialized,
    }
  }

  /**
   * Reset all WASM state (mainly for testing).
   * Recreates memoized functions to clear their internal caches.
   */
  static reset(): void {
    this.config = undefined
    this.walletCoreInstance = undefined
    this.dklsInitialized = false
    this.schnorrInitialized = false

    // Recreate memoized functions to clear their caches
    this.memoizedInitWalletCore = memoizeAsync(async () => {
      if (this.config?.wasmPaths?.walletCore) {
        console.warn('Custom WASM path for wallet-core is not supported. Using default path.')
      }
      const instance = await initWasm()
      this.walletCoreInstance = instance
      return instance
    })

    this.memoizedInitDkls = memoizeAsync(async () => {
      const wasmPath = this.config?.wasmPaths?.dkls

      if (typeof wasmPath === 'function') {
        const arrayBuffer = await wasmPath()
        await initializeDkls(arrayBuffer)
      } else if (wasmPath instanceof ArrayBuffer) {
        await initializeDkls(wasmPath)
      } else {
        await initializeDkls()
      }

      this.dklsInitialized = true
    })

    this.memoizedInitSchnorr = memoizeAsync(async () => {
      const wasmPath = this.config?.wasmPaths?.schnorr

      if (typeof wasmPath === 'function') {
        const arrayBuffer = await wasmPath()
        await initializeSchnorr(arrayBuffer)
      } else if (wasmPath instanceof ArrayBuffer) {
        await initializeSchnorr(wasmPath)
      } else {
        await initializeSchnorr()
      }

      this.schnorrInitialized = true
    })
  }
}
