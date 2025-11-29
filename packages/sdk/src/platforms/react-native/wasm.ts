/**
 * React Native WASM loader implementation
 * Uses fetch for WASM loading in React Native environments
 */
import type { PlatformWasmLoader } from '../types'

export class ReactNativeWasmLoader implements PlatformWasmLoader {
  async loadDkls(): Promise<ArrayBuffer> {
    // React Native WASM loading depends on the setup:
    // - Bundle WASM files with Metro bundler
    // - Load from remote URL via fetch
    // - Use custom native module

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
