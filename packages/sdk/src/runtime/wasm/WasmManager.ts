// Import all loaders to ensure registration
import './BrowserWasmLoader'
import './NodeWasmLoader'
import './ChromeWasmLoader'

import { initWasm } from '@trustwallet/wallet-core'

import initializeDkls from '../../../lib/dkls/vs_wasm.js'
import initializeSchnorr from '../../../lib/schnorr/vs_schnorr_wasm.js'
import { wasmLoaderRegistry } from './registry'
import type { WasmConfig } from './types'

/**
 * WasmManager handles initialization and management of all WASM modules.
 *
 * Uses Provider Registry Pattern for platform-specific loading.
 * Static methods - no instance needed.
 *
 * Supports lazy loading for optimal performance.
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading.
 */
export class WasmManager {
  private static config?: WasmConfig
  private static walletCoreInstance?: any
  private static dklsInitialized = false
  private static schnorrInitialized = false

  /**
   * Configure WASM loading (optional).
   * Must be called before any WASM modules are loaded.
   */
  static configure(config: WasmConfig): void {
    if (
      this.walletCoreInstance ||
      this.dklsInitialized ||
      this.schnorrInitialized
    ) {
      console.warn(
        'WASM modules already initialized, configuration may not take effect'
      )
    }
    this.config = config
  }

  /**
   * Get WalletCore instance for address derivation and operations.
   * Lazy loads on first access.
   */
  static async getWalletCore() {
    try {
      if (this.walletCoreInstance) {
        return this.walletCoreInstance
      }

      if (this.config?.wasmPaths?.walletCore) {
        console.warn(
          'Custom WASM path for wallet-core is not supported. Using default path.'
        )
      }

      this.walletCoreInstance = await initWasm()
      return this.walletCoreInstance
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`)
    }
  }

  /**
   * Initialize DKLS WASM module (ECDSA).
   * Lazy loads on first access.
   * Supports custom paths and environment-specific loading.
   */
  static async initializeDkls(): Promise<void> {
    try {
      if (this.dklsInitialized) {
        return
      }

      const wasmPath = this.config?.wasmPaths?.dkls

      // If wasmPath is already an ArrayBuffer, use it directly
      if (wasmPath instanceof ArrayBuffer) {
        await initializeDkls(wasmPath)
      } else if (wasmPath) {
        // Custom path provided - load as ArrayBuffer
        const wasmBuffer = await wasmLoaderRegistry.loadWasm(wasmPath)
        await initializeDkls(wasmBuffer)
      } else {
        // No custom path - use registry to resolve and load
        const defaultPath = wasmLoaderRegistry.resolvePath(
          'dkls/vs_wasm_bg.wasm'
        )
        const wasmBuffer = await wasmLoaderRegistry.loadWasm(defaultPath)
        await initializeDkls(wasmBuffer)
      }

      this.dklsInitialized = true
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA).
   * Lazy loads on first access.
   * Supports custom paths and environment-specific loading.
   */
  static async initializeSchnorr(): Promise<void> {
    try {
      if (this.schnorrInitialized) {
        return
      }

      const wasmPath = this.config?.wasmPaths?.schnorr

      // If wasmPath is already an ArrayBuffer, use it directly
      if (wasmPath instanceof ArrayBuffer) {
        await initializeSchnorr(wasmPath)
      } else if (wasmPath) {
        // Custom path provided - load as ArrayBuffer
        const wasmBuffer = await wasmLoaderRegistry.loadWasm(wasmPath)
        await initializeSchnorr(wasmBuffer)
      } else {
        // No custom path - use registry to resolve and load
        const defaultPath = wasmLoaderRegistry.resolvePath(
          'schnorr/vs_schnorr_wasm_bg.wasm'
        )
        const wasmBuffer = await wasmLoaderRegistry.loadWasm(defaultPath)
        await initializeSchnorr(wasmBuffer)
      }

      this.schnorrInitialized = true
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
      await Promise.all([
        this.getWalletCore(),
        this.initializeDkls(),
        this.initializeSchnorr(),
      ])
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
   */
  static reset(): void {
    this.config = undefined
    this.walletCoreInstance = undefined
    this.dklsInitialized = false
    this.schnorrInitialized = false
  }
}
