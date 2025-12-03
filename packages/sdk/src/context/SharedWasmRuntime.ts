/**
 * SharedWasmRuntime - Process-wide WASM module singleton
 *
 * Manages WalletCore WASM initialization. DKLS and Schnorr WASM modules
 * are handled by core's initializeMpcLib() - no SDK management needed.
 *
 * Thread-safe: Uses memoizeAsync to prevent race conditions during initialization.
 */

import { initWasm } from '@trustwallet/wallet-core'

import { memoizeAsync } from '../utils/memoizeAsync'
import type { WasmProvider } from './SdkContext'

/**
 * SharedWasmRuntime manages WalletCore WASM initialization.
 *
 * This is the only intentional "global" in the SDK - WASM modules are:
 * - Expensive to load
 * - Stateless after initialization
 * - Safe to share across SDK instances
 *
 * Note: DKLS and Schnorr WASM modules are handled by core's initializeMpcLib().
 * This class only manages @trustwallet/wallet-core.
 */
export class SharedWasmRuntime {
  private static walletCoreInstance?: any

  // Race-safe memoized initialization
  private static memoizedInitWalletCore = memoizeAsync(async () => {
    const instance = await initWasm()
    SharedWasmRuntime.walletCoreInstance = instance
    return instance
  })

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
   * Pre-load WalletCore WASM module.
   */
  static async initialize(): Promise<void> {
    await SharedWasmRuntime.getWalletCore()
  }

  /**
   * Get initialization status.
   */
  static getStatus() {
    return {
      walletCore: SharedWasmRuntime.walletCoreInstance !== undefined,
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
    SharedWasmRuntime.walletCoreInstance = undefined

    // Recreate memoized function to clear its cache
    SharedWasmRuntime.memoizedInitWalletCore = memoizeAsync(async () => {
      const instance = await initWasm()
      SharedWasmRuntime.walletCoreInstance = instance
      return instance
    })
  }
}
