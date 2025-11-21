// Import all providers to ensure registration
import './BrowserPolyfillProvider'
import './NodePolyfillProvider'

import { polyfillRegistry } from './registry'

/**
 * PolyfillManager handles initialization of platform-specific polyfills.
 *
 * Uses Provider Registry Pattern - providers self-register based on capabilities.
 * No if/switch statements needed for platform selection.
 *
 * Polyfills are best-effort - failures are logged but don't prevent initialization.
 *
 * @example
 * ```typescript
 * // Initialize all polyfills for current environment
 * await PolyfillManager.initialize()
 * ```
 */
export class PolyfillManager {
  private static initialized = false

  /**
   * Initialize all supported polyfills for current environment.
   * Automatically detects environment and runs appropriate polyfills.
   *
   * Safe to call multiple times - only initializes once.
   * Failures are logged but don't throw errors.
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    await polyfillRegistry.initializeAll()
    this.initialized = true
  }

  /**
   * Get all supported polyfill providers for current environment.
   * Useful for debugging.
   */
  static getSupportedProviders(): string[] {
    return polyfillRegistry.getSupportedProviders().map(p => p.name)
  }

  /**
   * Check if polyfills have been initialized.
   */
  static isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Reset initialization state (mainly for testing).
   */
  static reset(): void {
    this.initialized = false
  }
}
