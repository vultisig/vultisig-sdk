/**
 * Interface for platform-specific WASM loaders.
 */
export type WasmLoader = {
  /** Loader name (e.g., 'browser', 'node', 'chrome') */
  name: string

  /** Higher priority loaders are tried first */
  priority: number

  /** Check if this loader can run in current environment */
  isSupported: () => boolean

  /** Load WASM file from URL/path and return as ArrayBuffer */
  loadWasm: (url: string) => Promise<ArrayBuffer>

  /** Resolve filename to platform-specific URL/path */
  resolvePath: (filename: string) => string
}

/**
 * Central registry for WASM loaders.
 * Loaders self-register at module load time.
 */
class WasmLoaderRegistry {
  private loaders: WasmLoader[] = []
  private selectedLoader?: WasmLoader

  /**
   * Register a WASM loader.
   * Loaders are sorted by priority (highest first).
   */
  register(loader: WasmLoader): void {
    this.loaders.push(loader)
    // Keep sorted by priority descending
    this.loaders.sort((a, b) => b.priority - a.priority)
    // Reset selected loader when new loader registered
    this.selectedLoader = undefined
  }

  /**
   * Get all registered loaders.
   */
  getAllLoaders(): WasmLoader[] {
    return [...this.loaders]
  }

  /**
   * Find the best supported loader for current environment.
   * Result is cached after first call.
   */
  findBestLoader(): WasmLoader {
    if (this.selectedLoader) {
      return this.selectedLoader
    }

    for (const loader of this.loaders) {
      if (loader.isSupported()) {
        this.selectedLoader = loader
        return loader
      }
    }

    throw new Error(
      'No WASM loaders available. ' + 'This should never happen as at least one loader should be available.'
    )
  }

  /**
   * Load WASM file using best available loader.
   */
  async loadWasm(url: string): Promise<ArrayBuffer> {
    const loader = this.findBestLoader()
    return await loader.loadWasm(url)
  }

  /**
   * Resolve WASM filename to platform-specific path.
   */
  resolvePath(filename: string): string {
    const loader = this.findBestLoader()
    return loader.resolvePath(filename)
  }
}

// Export singleton registry
export const wasmLoaderRegistry = new WasmLoaderRegistry()
