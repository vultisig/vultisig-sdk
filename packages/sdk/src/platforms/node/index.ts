/**
 * Node.js platform entry point
 *
 * This bundle includes only Node.js-specific implementations:
 * - FileStorage (filesystem)
 * - NodeCrypto (native crypto)
 * - NodePolyfills (minimal)
 *
 * All browser code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses FileStorage by default
 * await sdk.initialize()
 * ```
 */

import './initializePrep'

// Now safe to import modules that may trigger WASM initialization
import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureCrypto } from '../../crypto'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { FileStorage } from './storage'

// Configure crypto
configureCrypto(new NodeCrypto())

// Configure default storage for Node
configureDefaultStorage(() => new FileStorage())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { FileStorage, NodeCrypto, NodePolyfills }

// Backwards-compatible alias
export { FileStorage as NodeStorage }

// Export FileStorage as the default Storage type for this platform
export { FileStorage as Storage }
