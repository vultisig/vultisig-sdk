import type { Storage } from './types'

export type StorageOptions = {
  type?: 'memory' | 'browser' | 'node' | 'chrome'
  basePath?: string
  customStorage?: Storage
}

export type StorageProvider = {
  /** Provider name (e.g., 'browser', 'node', 'chrome', 'memory') */
  name: string

  /** Higher priority providers are tried first */
  priority: number

  /** Check if this provider can run in current environment */
  isSupported: () => boolean

  /** Create storage instance */
  create: (options?: StorageOptions) => Storage
}

/**
 * Central registry for storage providers.
 * Providers self-register at module load time.
 */
class StorageProviderRegistry {
  private providers: StorageProvider[] = []

  /**
   * Register a storage provider.
   * Providers are sorted by priority (highest first).
   */
  register(provider: StorageProvider): void {
    this.providers.push(provider)
    // Keep sorted by priority descending
    this.providers.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Get all registered providers.
   */
  getAllProviders(): StorageProvider[] {
    return [...this.providers]
  }

  /**
   * Find the best supported provider for current environment.
   */
  findBestProvider(): StorageProvider | null {
    for (const provider of this.providers) {
      if (provider.isSupported()) {
        return provider
      }
    }
    return null
  }

  /**
   * Create storage using best available provider.
   */
  createStorage(options?: StorageOptions): Storage {
    // Custom storage takes precedence
    if (options?.customStorage) {
      return options.customStorage
    }

    // Specific type requested
    if (options?.type) {
      const provider = this.providers.find(p => p.name === options.type)
      if (!provider) {
        throw new Error(
          `Storage provider "${options.type}" not found. ` + `Available: ${this.providers.map(p => p.name).join(', ')}`
        )
      }
      if (!provider.isSupported()) {
        throw new Error(`Storage provider "${options.type}" is not supported in this environment`)
      }
      return provider.create(options)
    }

    // Auto-select best provider
    const provider = this.findBestProvider()
    if (!provider) {
      throw new Error(
        'No storage providers available. This should never happen as MemoryStorage should always be available.'
      )
    }

    return provider.create(options)
  }
}

// Export singleton registry
export const storageRegistry = new StorageProviderRegistry()
