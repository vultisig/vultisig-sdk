/**
 * Platform-specific interfaces that each platform implementation must provide
 */

/**
 * WASM loader interface for platform-specific WASM loading
 */
export type PlatformWasmLoader = {
  /**
   * Load DKLS WASM module
   */
  loadDkls(): Promise<ArrayBuffer>;

  /**
   * Load Schnorr WASM module
   */
  loadSchnorr(): Promise<ArrayBuffer>;

  /**
   * Resolve WASM path for a given module
   */
  resolvePath(module: string): string;
};

/**
 * Crypto interface for platform-specific crypto operations
 */
export type PlatformCrypto = {
  /**
   * Generate a random UUID (v4)
   */
  randomUUID(): string;

  /**
   * Validate that crypto APIs are available (optional)
   * Only needed for React Native to check polyfills
   */
  validateCrypto?(): void;
};

/**
 * Polyfill interface for platform-specific polyfills
 */
export type PlatformPolyfills = {
  /**
   * Initialize platform-specific polyfills
   */
  initialize(): Promise<void>;
};
