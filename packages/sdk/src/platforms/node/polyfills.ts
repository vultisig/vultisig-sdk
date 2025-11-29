/**
 * Node.js polyfills implementation
 * Node.js has native implementations - minimal polyfills needed
 */
import type { PlatformPolyfills } from '../types'

export class NodePolyfills implements PlatformPolyfills {
  async initialize(): Promise<void> {
    // Node.js has native APIs - no polyfills needed
    // WebSocket is provided by 'ws' package (external dependency)
  }
}
