/**
 * Browser polyfills implementation
 * Polyfills for Node.js APIs needed in browser
 */
import type { PlatformPolyfills } from '../types'

export class BrowserPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Polyfill Buffer if needed
    if (typeof globalThis.Buffer === 'undefined') {
      const { Buffer } = await import('buffer')
      ;(globalThis as any).Buffer = Buffer
    }

    // Polyfill process if needed
    if (typeof globalThis.process === 'undefined') {
      ;(globalThis as any).process = { env: {} }
    }
  }
}
