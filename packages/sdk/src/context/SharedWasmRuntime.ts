/**
 * SharedWasmRuntime - Process-wide WASM module singleton
 *
 * WASM modules are expensive to load (~10MB) and stateless after initialization.
 * This singleton is intentionally shared across all SDK instances for performance.
 *
 * Thread-safe: Uses memoizeAsync to prevent race conditions during initialization.
 */

import { initWasm } from '@trustwallet/wallet-core'

import { memoizeAsync } from '../utils/memoizeAsync'
import type { WasmConfig } from '../wasm/types'
import type { WasmProvider } from './SdkContext'

/**
 * SharedWasmRuntime manages WASM module initialization.
 *
 * This is the only intentional "global" in the SDK - WASM modules are:
 * - Expensive to load (~10MB total)
 * - Stateless after initialization
 * - Safe to share across SDK instances
 */
export class SharedWasmRuntime {
  private static config?: WasmConfig
  private static walletCoreInstance?: any
  private static dklsInitialized = false
  private static schnorrInitialized = false

  // Race-safe memoized initialization functions
  private static memoizedInitWalletCore = memoizeAsync(async () => {
    if (SharedWasmRuntime.config?.wasmPaths?.walletCore) {
      console.warn('Custom WASM path for wallet-core is not supported. Using default path.')
    }
    const instance = await initWasm()
    SharedWasmRuntime.walletCoreInstance = instance
    return instance
  })

  private static memoizedInitDkls = memoizeAsync(async () => {
    const wasmLoader = SharedWasmRuntime.config?.wasmPaths?.dkls

    if (!wasmLoader) {
      throw new Error(
        'DKLS WASM loader not configured. ' +
          'This should be configured automatically by platform bundles. ' +
          'Ensure you are importing from the correct platform entry point.'
      )
    }

    const arrayBuffer = await wasmLoader()
    const { default: initializeDkls } = await import('../../../lib/dkls/vs_wasm.js')
    await initializeDkls(arrayBuffer)

    SharedWasmRuntime.dklsInitialized = true
  })

  private static memoizedInitSchnorr = memoizeAsync(async () => {
    const wasmLoader = SharedWasmRuntime.config?.wasmPaths?.schnorr

    if (!wasmLoader) {
      throw new Error(
        'Schnorr WASM loader not configured. ' +
          'This should be configured automatically by platform bundles. ' +
          'Ensure you are importing from the correct platform entry point.'
      )
    }

    const arrayBuffer = await wasmLoader()
    const { default: initializeSchnorr } = await import('../../../lib/schnorr/vs_schnorr_wasm.js')
    await initializeSchnorr(arrayBuffer)

    SharedWasmRuntime.schnorrInitialized = true
  })

  /**
   * Configure WASM loading.
   * Called automatically by platform bundles at module load time.
   */
  static configure(config: WasmConfig): void {
    if (
      SharedWasmRuntime.walletCoreInstance ||
      SharedWasmRuntime.dklsInitialized ||
      SharedWasmRuntime.schnorrInitialized
    ) {
      console.warn('WASM modules already initialized, configuration may not take effect')
    }
    SharedWasmRuntime.config = config
  }

  /**
   * Get WalletCore instance for address derivation and operations.
   * Lazy loads on first access.
   * Thread-safe: Concurrent calls will wait for same initialization promise.
   */
  static async getWalletCore() {
    try {
      if (SharedWasmRuntime.walletCoreInstance) {
        return SharedWasmRuntime.walletCoreInstance
      }

      return await SharedWasmRuntime.memoizedInitWalletCore()
    } catch (error) {
      throw new Error(`Failed to initialize WalletCore WASM: ${error}`)
    }
  }

  /**
   * Initialize DKLS WASM module (ECDSA).
   * Thread-safe: Concurrent calls wait for same initialization promise.
   */
  static async initializeDkls(): Promise<void> {
    try {
      if (SharedWasmRuntime.dklsInitialized) {
        return
      }

      await SharedWasmRuntime.memoizedInitDkls()
    } catch (error) {
      throw new Error(`Failed to initialize DKLS WASM: ${error}`)
    }
  }

  /**
   * Initialize Schnorr WASM module (EdDSA).
   * Thread-safe: Concurrent calls wait for same initialization promise.
   */
  static async initializeSchnorr(): Promise<void> {
    try {
      if (SharedWasmRuntime.schnorrInitialized) {
        return
      }

      await SharedWasmRuntime.memoizedInitSchnorr()
    } catch (error) {
      throw new Error(`Failed to initialize Schnorr WASM: ${error}`)
    }
  }

  /**
   * Pre-load all WASM modules.
   * Initializes in parallel for better performance.
   */
  static async initialize(): Promise<void> {
    try {
      await Promise.all([
        SharedWasmRuntime.getWalletCore(),
        SharedWasmRuntime.initializeDkls(),
        SharedWasmRuntime.initializeSchnorr(),
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
      walletCore: SharedWasmRuntime.walletCoreInstance !== undefined,
      dkls: SharedWasmRuntime.dklsInitialized,
      schnorr: SharedWasmRuntime.schnorrInitialized,
    }
  }

  /**
   * Create a WasmProvider instance that wraps this shared runtime.
   * Each SDK instance gets its own WasmProvider, but they all share
   * the underlying WASM modules.
   */
  static createProvider(): WasmProvider {
    return {
      getWalletCore: () => SharedWasmRuntime.getWalletCore(),
      initializeDkls: () => SharedWasmRuntime.initializeDkls(),
      initializeSchnorr: () => SharedWasmRuntime.initializeSchnorr(),
      initialize: () => SharedWasmRuntime.initialize(),
      getStatus: () => SharedWasmRuntime.getStatus(),
    }
  }

  /**
   * Reset all WASM state (for testing only).
   * Recreates memoized functions to clear their internal caches.
   * @internal
   */
  static reset(): void {
    SharedWasmRuntime.config = undefined
    SharedWasmRuntime.walletCoreInstance = undefined
    SharedWasmRuntime.dklsInitialized = false
    SharedWasmRuntime.schnorrInitialized = false

    // Recreate memoized functions to clear their caches
    SharedWasmRuntime.memoizedInitWalletCore = memoizeAsync(async () => {
      if (SharedWasmRuntime.config?.wasmPaths?.walletCore) {
        console.warn('Custom WASM path for wallet-core is not supported. Using default path.')
      }
      const instance = await initWasm()
      SharedWasmRuntime.walletCoreInstance = instance
      return instance
    })

    SharedWasmRuntime.memoizedInitDkls = memoizeAsync(async () => {
      const wasmLoader = SharedWasmRuntime.config?.wasmPaths?.dkls

      if (!wasmLoader) {
        throw new Error(
          'DKLS WASM loader not configured. ' +
            'This should be configured automatically by platform bundles. ' +
            'Ensure you are importing from the correct platform entry point.'
        )
      }

      const arrayBuffer = await wasmLoader()
      const { default: initializeDkls } = await import('../../../lib/dkls/vs_wasm.js')
      await initializeDkls(arrayBuffer)

      SharedWasmRuntime.dklsInitialized = true
    })

    SharedWasmRuntime.memoizedInitSchnorr = memoizeAsync(async () => {
      const wasmLoader = SharedWasmRuntime.config?.wasmPaths?.schnorr

      if (!wasmLoader) {
        throw new Error(
          'Schnorr WASM loader not configured. ' +
            'This should be configured automatically by platform bundles. ' +
            'Ensure you are importing from the correct platform entry point.'
        )
      }

      const arrayBuffer = await wasmLoader()
      const { default: initializeSchnorr } = await import('../../../lib/schnorr/vs_schnorr_wasm.js')
      await initializeSchnorr(arrayBuffer)

      SharedWasmRuntime.schnorrInitialized = true
    })
  }
}
