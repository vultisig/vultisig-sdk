/**
 * Electron Main Process crypto implementation
 * Uses native Node.js Web Crypto API (available in Electron main process)
 */
import { webcrypto } from 'crypto'

import type { PlatformCrypto } from '../types'

export class ElectronMainCrypto implements PlatformCrypto {
  randomUUID(): string {
    return webcrypto.randomUUID()
  }
}
