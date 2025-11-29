/**
 * Node.js platform entry point
 *
 * This bundle includes only Node.js-specific implementations:
 * - NodeStorage (filesystem)
 * - NodeWasmLoader (fs.readFile)
 * - NodeCrypto (native crypto)
 * - NodePolyfills (minimal)
 *
 * All browser/React Native code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, NodeStorage } from '@vultisig/sdk/node'
 *
 * const sdk = new Vultisig({
 *   storage: new NodeStorage({ basePath: '~/.myapp' })
 * })
 * ```
 */

// Platform-specific implementations
// Configure global crypto to use Node implementation
import { configureCrypto } from '../../crypto'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { NodeStorage } from './storage'
import { NodeWasmLoader } from './wasm'
configureCrypto(new NodeCrypto())

// Configure SharedWasmRuntime to use Node loader (process-wide singleton)
import { SharedWasmRuntime } from '../../context/SharedWasmRuntime'
const wasmLoader = new NodeWasmLoader()
SharedWasmRuntime.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { NodeCrypto, NodePolyfills, NodeStorage, NodeWasmLoader }
