import { initializeMpcLib } from '../core/mpc/lib/initialize'
import { memoizeAsync } from '../lib/utils/memoizeAsync'
import { initWasm } from '@trustwallet/wallet-core'

/**
 * WASMManager handles initialization and management of all WASM modules
 * Coordinates wallet-core, DKLS, and Schnorr WASM loading
 */
export class WASMManager {
  private initialized = false
  private walletCoreReady = false
  private dklsReady = false
  private schnorrReady = false

  constructor(private config?: {
    autoInit?: boolean
    wasmPaths?: {
      walletCore?: string
      dkls?: string
      schnorr?: string
    }
  }) {}

  /**
   * Initialize all WASM modules
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Initialize in parallel for better performance
      await Promise.all([
        this.initializeWalletCore(),
        this.initializeDkls(),
        this.initializeSchnorr()
      ])

      this.initialized = true
    } catch (error) {
      throw new Error(`Failed to initialize WASM modules: ${error}`)
    }
  }

  private walletCoreInstance: any = null
  private getWalletCoreInit = memoizeAsync(initWasm)

  /**
   * Initialize Trust Wallet Core WASM
   */
  private async initializeWalletCore(): Promise<void> {
    try {
      this.walletCoreInstance = await this.getWalletCoreInit()
      this.walletCoreReady = true
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`)
    }
  }

  /**
   * Initialize DKLS WASM module
   */
  private async initializeDkls(): Promise<void> {
    try {
      await initializeMpcLib('ecdsa')
      this.dklsReady = true
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module
   */
  private async initializeSchnorr(): Promise<void> {
    try {
      await initializeMpcLib('eddsa')
      this.schnorrReady = true
    } catch (error) {
      throw new Error(`Failed to initialize Schnorr WASM: ${error}`)
    }
  }

  /**
   * Check if all WASM modules are initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Check if specific WASM module is ready
   */
  isModuleReady(module: 'walletCore' | 'dkls' | 'schnorr'): boolean {
    switch (module) {
      case 'walletCore':
        return this.walletCoreReady
      case 'dkls':
        return this.dklsReady
      case 'schnorr':
        return this.schnorrReady
      default:
        return false
    }
  }

  /**
   * Get initialization status for all modules
   */
  getStatus() {
    return {
      initialized: this.initialized,
      modules: {
        walletCore: this.walletCoreReady,
        dkls: this.dklsReady,
        schnorr: this.schnorrReady
      }
    }
  }

  /**
   * Get WalletCore instance for address derivation and operations
   */
  async getWalletCore() {
    if (!this.walletCoreReady || !this.walletCoreInstance) {
      throw new Error('WalletCore WASM not initialized. Call initialize() first.')
    }
    
    return this.walletCoreInstance
  }

  /**
   * Get the memoized WalletCore getter (same instance as used by extension)
   */
  getWalletCoreGetter() {
    return this.walletCoreInstance
  }

  /**
   * Force re-initialization of all modules
   */
  async reinitialize(): Promise<void> {
    this.initialized = false
    this.walletCoreReady = false
    this.dklsReady = false
    this.schnorrReady = false
    this.walletCoreInstance = null
    
    await this.initialize()
  }
}