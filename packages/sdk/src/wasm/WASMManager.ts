import { initializeMpcLib } from '@core/mpc/lib/initialize'
import { memoizeAsync } from '@lib/utils/memoizeAsync'
import { initWasm } from '@trustwallet/wallet-core'

export interface WASMConfig {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: string
    dkls?: string
    schnorr?: string
  }
}

/**
 * WASMManager handles initialization and management of all WASM modules
 * Supports lazy loading for optimal performance
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading
 */
export class WASMManager {
  private config?: WASMConfig

  constructor(config?: WASMConfig) {
    this.config = config
  }

  // Memoized initialization functions for lazy loading
  // Note: initWasm from wallet-core doesn't support custom paths
  private getWalletCoreInit = memoizeAsync(() => initWasm())
  private getDklsInit = memoizeAsync((wasmUrl?: string) =>
    initializeMpcLib('ecdsa')
  )
  private getSchnorrInit = memoizeAsync((wasmUrl?: string) =>
    initializeMpcLib('eddsa')
  )

  /**
   * Get WalletCore instance for address derivation and operations
   * Lazy loads on first access
   * Note: Custom WASM paths not supported for wallet-core
   */
  async getWalletCore() {
    try {
      if (this.config?.wasmPaths?.walletCore) {
        console.warn(
          'Custom WASM path for wallet-core is not supported. Using default path.'
        )
      }
      return await this.getWalletCoreInit()
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`)
    }
  }

  /**
   * Initialize DKLS WASM module (ECDSA)
   * Lazy loads on first access
   */
  async initializeDkls(): Promise<void> {
    try {
      const customPath = this.config?.wasmPaths?.dkls
      await this.getDklsInit(customPath)
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA)
   * Lazy loads on first access
   */
  async initializeSchnorr(): Promise<void> {
    try {
      const customPath = this.config?.wasmPaths?.schnorr
      await this.getSchnorrInit(customPath)
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
    // Since we're using memoization, we can't easily track status
    // without calling the functions. This is a simplified implementation.
    return {
      note: 'Modules are lazy-loaded on first access via memoization',
    }
  }
}
