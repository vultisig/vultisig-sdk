/**
 * Platform-specific interfaces that each platform implementation must provide
 */

/**
 * Crypto interface for platform-specific crypto operations
 */
export type PlatformCrypto = {
  /**
   * Generate a random UUID (v4)
   */
  randomUUID(): string

  /**
   * Validate that crypto APIs are available (optional)
   * Only needed for React Native to check polyfills
   */
  validateCrypto?(): void
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
