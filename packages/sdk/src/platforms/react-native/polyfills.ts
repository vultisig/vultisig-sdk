/**
 * React Native polyfills implementation
 * Polyfills for Node.js and Web APIs
 */
import type { PlatformPolyfills } from '../types'

export class ReactNativePolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // React Native needs various polyfills
    // Buffer, process, crypto, stream, etc.

    // Note: Users should set up polyfills in their app
    // See: https://github.com/parshap/node-libs-react-native

    // Minimal setup - check if required globals exist
    if (typeof Buffer === 'undefined') {
      console.warn('Buffer not available. Install buffer package and set up polyfills.')
    }

    if (typeof process === 'undefined') {
      ;(global as any).process = { env: {} }
    }
  }
}
