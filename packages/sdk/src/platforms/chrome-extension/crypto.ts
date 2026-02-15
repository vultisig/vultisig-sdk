/**
 * Chrome Extension crypto implementation
 * Uses Web Crypto API (available in all extension contexts including service workers)
 */
import type { PlatformCrypto } from '../types'

export class ChromeExtensionCrypto implements PlatformCrypto {
  randomUUID(): string {
    return globalThis.crypto.randomUUID()
  }
}
