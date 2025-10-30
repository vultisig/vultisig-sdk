import { initializeMpcLib } from '@core/mpc/lib/initialize'
import { memoizeAsync } from '@lib/utils/memoizeAsync'
import { initWasm } from '@trustwallet/wallet-core'

/**
 * WASMManager handles initialization and management of all WASM modules
 * Singleton instance with lazy loading for optimal performance
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading
 */
export class WASMManager {
  private static instance: WASMManager | null = null

  /**
   * Get singleton instance
   */
  static getInstance(): WASMManager {
    if (!WASMManager.instance) {
      WASMManager.instance = new WASMManager()
    }
    return WASMManager.instance
  }

  /**
   * Reset singleton instance (for testing)
   */
  static reset(): void {
    WASMManager.instance = null
  }

  // Private constructor to enforce singleton pattern
  private constructor() {}

  // Memoized initialization functions for lazy loading
  private getWalletCoreInit = memoizeAsync(initWasm)
  private getDklsInit = memoizeAsync(() => initializeMpcLib('ecdsa'))
  private getSchnorrInit = memoizeAsync(() => initializeMpcLib('eddsa'))

  /**
   * Get WalletCore instance for address derivation and operations
   * Lazy loads on first access
   */
  async getWalletCore() {
    try {
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
      await this.getDklsInit()
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
      await this.getSchnorrInit()
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
