/**
 * Browser crypto implementation
 * Uses Web Crypto API (standard in all modern browsers)
 */

import type { PlatformCrypto } from '../types'

export class BrowserCrypto implements PlatformCrypto {
  randomUUID(): string {
    return globalThis.crypto.randomUUID()
  }
}
