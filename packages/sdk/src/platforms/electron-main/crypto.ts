/**
 * Electron Main process crypto implementation
 * Uses native Node.js crypto (same as Node platform)
 */
import type { PlatformCrypto } from '../../shared/platform-types'

export class ElectronMainCrypto implements PlatformCrypto {
  async initialize(): Promise<void> {
    // Electron main process has native Node.js crypto
  }
}
