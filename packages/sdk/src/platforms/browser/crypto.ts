/**
 * Browser crypto implementation
 * Uses Web Crypto API
 */
import type { PlatformCrypto } from '../../shared/platform-types'

export class BrowserCrypto implements PlatformCrypto {
  async initialize(): Promise<void> {
    // Check if crypto API is available
    if (typeof window !== 'undefined' && !window.crypto) {
      throw new Error('Web Crypto API not available')
    }
  }
}
