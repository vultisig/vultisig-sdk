/**
 * Browser polyfills implementation
 * Polyfills for Node.js APIs needed in browser
 */
import type { PlatformPolyfills } from '../types'

export class BrowserPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Polyfill Buffer if needed
    if (typeof window !== 'undefined' && typeof window.Buffer === 'undefined') {
      const { Buffer } = await import('buffer')
      window.Buffer = Buffer
    }

    // Polyfill process if needed
    if (typeof window !== 'undefined' && typeof window.process === 'undefined') {
      window.process = { env: {} } as any
    }
  }
}
