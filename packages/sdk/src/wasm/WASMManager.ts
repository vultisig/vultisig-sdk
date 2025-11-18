import { initWasm } from '@trustwallet/wallet-core'

import initializeDkls from '../../../lib/dkls/vs_wasm.js'
import initializeSchnorr from '../../../lib/schnorr/vs_schnorr_wasm.js'
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

      const wasmPath = this.config?.wasmPaths?.dkls

      // If wasmPath is already an ArrayBuffer, use it directly
      if (wasmPath instanceof ArrayBuffer) {
        await initializeDkls(wasmPath)
      } else if (wasmPath) {
        // Custom path provided - load as ArrayBuffer
        const wasmBuffer = await loadWasm(wasmPath)
        await initializeDkls(wasmBuffer)
      } else {
        // No custom path - let environment determine loading strategy
        const { detectEnvironment } = await import('../runtime/environment')
        const env = detectEnvironment()

        if (env === 'node' || env === 'electron-main') {
          // Node.js: get default path and load as ArrayBuffer
          const defaultPath = getDklsWasmPath()
          const wasmBuffer = await loadWasm(defaultPath)
          await initializeDkls(wasmBuffer)
        } else {
          // Browser: pass undefined to let wasm-bindgen resolve path
          await initializeDkls(undefined)
        }
      }

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

      const wasmPath = this.config?.wasmPaths?.schnorr

      // If wasmPath is already an ArrayBuffer, use it directly
      if (wasmPath instanceof ArrayBuffer) {
        await initializeSchnorr(wasmPath)
      } else if (wasmPath) {
        // Custom path provided - load as ArrayBuffer
        const wasmBuffer = await loadWasm(wasmPath)
        await initializeSchnorr(wasmBuffer)
      } else {
        // No custom path - let environment determine loading strategy
        const { detectEnvironment } = await import('../runtime/environment')
        const env = detectEnvironment()

        if (env === 'node' || env === 'electron-main') {
          // Node.js: get default path and load as ArrayBuffer
          const defaultPath = getSchnorrWasmPath()
          const wasmBuffer = await loadWasm(defaultPath)
          await initializeSchnorr(wasmBuffer)
        } else {
          // Browser: pass undefined to let wasm-bindgen resolve path
          await initializeSchnorr(undefined)
        }
      }

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
