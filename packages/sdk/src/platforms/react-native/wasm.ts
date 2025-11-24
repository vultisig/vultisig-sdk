/**
 * React Native WASM loader implementation
 * Uses require() for bundled WASM or fetch for remote loading
 */
import type { PlatformWasmLoader } from '../../shared/platform-types'

export class ReactNativeWasmLoader implements PlatformWasmLoader {
  async loadDkls(): Promise<ArrayBuffer> {
    // React Native WASM loading depends on the setup
    // Option 1: Bundle WASM files and use require
    // Option 2: Load from remote URL
    // Option 3: Use Hermes bytecode

    throw new Error('React Native WASM loading not yet implemented. Please configure WASM paths manually.')
  }

  async loadSchnorr(): Promise<ArrayBuffer> {
    throw new Error('React Native WASM loading not yet implemented. Please configure WASM paths manually.')
  }

  resolvePath(filename: string): string {
    // React Native doesn't have a standard WASM path resolution
    return filename
  }
}
