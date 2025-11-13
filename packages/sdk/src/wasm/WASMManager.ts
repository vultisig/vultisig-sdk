import initializeDkls from '@lib/dkls/vs_wasm'
import initializeSchnorr from '@lib/schnorr/vs_schnorr_wasm'
import { initWasm } from '@trustwallet/wallet-core'

import { loadWasm } from './wasmLoader'
import { getDklsWasmPath, getSchnorrWasmPath } from './wasmPaths'

export type WASMConfig = {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: string | ArrayBuffer
    dkls?: string | ArrayBuffer
    schnorr?: string | ArrayBuffer
  }
}

/**
 * WASMManager handles initialization and management of all WASM modules
 * Supports lazy loading for optimal performance
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading
 *
 * Automatically detects runtime environment (Node.js, browser, Electron, Chrome extension)
 * and uses appropriate WASM loading strategy.
 */
export class WASMManager {
  private config?: WASMConfig
  private walletCoreInstance?: any
  private dklsInitialized = false
  private schnorrInitialized = false

  constructor(config?: WASMConfig) {
    this.config = config
  }

  /**
   * Get WalletCore instance for address derivation and operations
   * Lazy loads on first access
   * Note: Custom WASM paths not supported for wallet-core
   */
  async getWalletCore() {
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
   * Initialize DKLS WASM module (ECDSA)
   * Lazy loads on first access
   * Supports custom paths and environment-specific loading
   */
  async initializeDkls(): Promise<void> {
    try {
      if (this.dklsInitialized) {
        return
      }

      const wasmPath = this.config?.wasmPaths?.dkls || getDklsWasmPath()

      // Load WASM as ArrayBuffer (handles file:// URLs in Node.js)
      const wasmBuffer = await loadWasm(wasmPath)

      // Pass ArrayBuffer to WASM init (bypasses fetch)
      await initializeDkls(wasmBuffer)

      this.dklsInitialized = true
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA)
   * Lazy loads on first access
   * Supports custom paths and environment-specific loading
   */
  async initializeSchnorr(): Promise<void> {
    try {
      if (this.schnorrInitialized) {
        return
      }

      const wasmPath = this.config?.wasmPaths?.schnorr || getSchnorrWasmPath()

      // Load WASM as ArrayBuffer (handles file:// URLs in Node.js)
      const wasmBuffer = await loadWasm(wasmPath)

      // Pass ArrayBuffer to WASM init (bypasses fetch)
      await initializeSchnorr(wasmBuffer)

      this.schnorrInitialized = true
    } catch (error) {
      throw new Error(`Failed to initialize Schnorr WASM: ${error}`)
    }
  }

  /**
   * Pre-load all WASM modules (optional)
   * Useful for upfront initialization to avoid delays later
   */
  async initialize(): Promise<void> {
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
   * Get initialization status for all modules
   */
  getStatus() {
    return {
      walletCore: this.walletCoreInstance !== undefined,
      dkls: this.dklsInitialized,
      schnorr: this.schnorrInitialized,
    }
  }
}
