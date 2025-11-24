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
 */

// Platform-specific implementations
// Configure global storage to use Node implementation
import { GlobalStorage } from '../../storage/GlobalStorage'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { NodeStorage } from './storage'
import { NodeWasmLoader } from './wasm'
GlobalStorage.configure(new NodeStorage())

// Configure WASM to use Node loader
import { WasmManager } from '../../wasm'
const wasmLoader = new NodeWasmLoader()
WasmManager.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for advanced users
export { NodeCrypto, NodePolyfills, NodeStorage, NodeWasmLoader }
