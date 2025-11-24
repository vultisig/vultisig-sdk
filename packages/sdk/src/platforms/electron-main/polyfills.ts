/**
 * Electron Main process polyfills
 * No polyfills needed - has full Node.js APIs
 */
import type { PlatformPolyfills } from '../../shared/platform-types'

export class ElectronMainPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Electron main process has full Node.js APIs
  }
}
