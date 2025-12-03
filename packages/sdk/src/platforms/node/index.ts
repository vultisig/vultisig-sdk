/**
 * Node.js platform entry point
 *
 * This bundle includes only Node.js-specific implementations:
 * - FileStorage (filesystem)
 * - NodeCrypto (native crypto)
 * - NodePolyfills (minimal)
 * - loadWasmModules (filesystem WASM loading)
 * - createVultisig (factory with auto WASM loading)
 *
 * All browser/React Native code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { createVultisig, FileStorage } from '@vultisig/sdk/node'
 *
 * // Recommended: use factory (handles WASM loading automatically)
 * const sdk = await createVultisig({
 *   storage: new FileStorage({ basePath: '~/.myapp' })
 * })
 *
 * // Alternative: manual WASM loading
 * import { Vultisig, loadWasmModules } from '@vultisig/sdk/node'
 * const wasmModules = await loadWasmModules()
 * const sdk = new Vultisig({
 *   storage: new FileStorage({ basePath: '~/.myapp' }),
 *   wasmModules
 * })
 * await sdk.initialize()
 * ```
 */

// Platform-specific implementations
// Configure global crypto to use Node implementation
import { configureCrypto } from '../../crypto'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { FileStorage } from './storage'
configureCrypto(new NodeCrypto())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { FileStorage, NodeCrypto, NodePolyfills }

// Export WASM loading utilities
export type { CreateVultisigConfig, WasmPaths } from './wasm'
export { createVultisig, loadWasmModules } from './wasm'

// Backwards-compatible alias (deprecated)
export { FileStorage as NodeStorage }
