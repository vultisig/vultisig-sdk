/**
 * Interface for platform-specific polyfill providers.
 */
export type PolyfillProvider = {
  /** Provider name (e.g., 'node', 'browser') */
  name: string

  /** Higher priority providers are tried first */
  priority: number

  /** Check if this provider should run in current environment */
  isSupported: () => boolean

  /** Initialize polyfills for this environment */
  initialize: () => Promise<void>
}

/**
 * Central registry for polyfill providers.
 * Providers self-register at module load time.
 *
 * Uses Provider Registry Pattern - no if/switch statements needed.
 */
class PolyfillProviderRegistry {
  private providers: PolyfillProvider[] = []

  /**
   * Register a polyfill provider.
   * Providers are sorted by priority (highest first).
   */
  register(provider: PolyfillProvider): void {
    this.providers.push(provider)
    // Keep sorted by priority descending
    this.providers.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Get all registered providers.
   */
  getAllProviders(): PolyfillProvider[] {
    return [...this.providers]
  }

  /**
   * Get all supported providers for current environment.
   * Returns all providers that pass their isSupported() check.
   */
  getSupportedProviders(): PolyfillProvider[] {
    return this.providers.filter(p => p.isSupported())
  }

  /**
   * Initialize all supported polyfill providers.
   * Runs all providers that are supported in current environment.
   */
  async initializeAll(): Promise<void> {
    const supported = this.getSupportedProviders()

    // Run all supported providers in priority order
    for (const provider of supported) {
      try {
        await provider.initialize()
      } catch (error) {
        // Log warning but continue - polyfills are best-effort
        console.warn(
          `[Vultisig SDK] Failed to initialize ${provider.name} polyfills:`,
          error
        )
      }
    }
  }
}

// Export singleton registry
export const polyfillRegistry = new PolyfillProviderRegistry()
