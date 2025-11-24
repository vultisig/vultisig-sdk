/**
 * Platform-specific interfaces that each platform implementation must provide
 */

import type { Storage } from '../storage/types'

/**
 * WASM loader interface for platform-specific WASM loading
 */
export type PlatformWasmLoader = {
  /**
   * Load DKLS WASM module
   */
  loadDkls(): Promise<ArrayBuffer>

  /**
   * Load Schnorr WASM module
   */
  loadSchnorr(): Promise<ArrayBuffer>

  /**
   * Resolve WASM path for a given module
   */
  resolvePath(module: string): string
}

/**
 * Crypto interface for platform-specific crypto operations
 */
export type PlatformCrypto = {
  /**
   * Initialize crypto subsystem if needed
   */
  initialize(): Promise<void>
}

/**
 * Polyfill interface for platform-specific polyfills
 */
export type PlatformPolyfills = {
  /**
   * Initialize platform-specific polyfills
   */
  initialize(): Promise<void>
}

/**
 * Platform configuration that wires up all platform-specific implementations
 */
export type PlatformConfig = {
  storage: Storage
  wasmLoader: PlatformWasmLoader
  crypto: PlatformCrypto
  polyfills: PlatformPolyfills
}
