/**
 * Electron Main Process polyfills implementation
 * Main process has full Node.js APIs - minimal polyfills needed
 */
import type { PlatformPolyfills } from '../types'

export class ElectronMainPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Electron main process has native Node.js APIs - no polyfills needed
    // WebSocket is provided by 'ws' package (external dependency)
  }
}
