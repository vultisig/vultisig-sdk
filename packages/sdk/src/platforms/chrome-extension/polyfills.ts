/**
 * Chrome Extension polyfills
 *
 * Uses globalThis instead of window since service workers don't have window.
 * Extension pages (popup, options) have both window and globalThis.
 */
import type { PlatformPolyfills } from '../types'

export class ChromeExtensionPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Polyfill Buffer if needed (use globalThis, not window — service workers lack window)
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
