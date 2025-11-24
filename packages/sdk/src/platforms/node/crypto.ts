/**
 * Node.js crypto implementation
 * Uses native Node.js crypto module
 */
import type { PlatformCrypto } from '../../shared/platform-types'

export class NodeCrypto implements PlatformCrypto {
  async initialize(): Promise<void> {
    // Node.js has native crypto - no initialization needed
  }
}
