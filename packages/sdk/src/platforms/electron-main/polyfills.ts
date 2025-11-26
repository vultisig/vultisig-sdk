/**
 * Electron Main process polyfills
 * No polyfills needed - has full Node.js APIs
 */
import type { PlatformPolyfills } from "../types";

export class ElectronMainPolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Electron main process has full Node.js APIs
  }
}
