/**
 * Node.js crypto implementation
 * Uses native Node.js Web Crypto API
 */
import { webcrypto } from 'crypto'

import type { PlatformCrypto } from '../types'

export class NodeCrypto implements PlatformCrypto {
  randomUUID(): string {
    return webcrypto.randomUUID()
  }
}
