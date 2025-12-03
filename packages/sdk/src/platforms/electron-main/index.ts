/**
 * Electron Main process entry point
 *
 * This bundle includes Electron Main-specific implementations:
 * - ElectronMainStorage (filesystem with userData path)
 * - ElectronMainCrypto (native crypto)
 * - ElectronMainPolyfills (none needed)
 * - WASM loading helpers (explicit byte loading)
 *
 * All browser/renderer code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { createVultisig, ElectronMainStorage } from '@vultisig/sdk/electron-main'
 *
 * const sdk = await createVultisig({
 *   storage: new ElectronMainStorage()
 * })
 * ```
 */

// Platform-specific implementations
// Configure global crypto to use Electron Main implementation
import { configureCrypto } from '../../crypto'
import { ElectronMainCrypto } from './crypto'
import { ElectronMainPolyfills } from './polyfills'
import { ElectronMainStorage } from './storage'
configureCrypto(new ElectronMainCrypto())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { ElectronMainCrypto, ElectronMainPolyfills, ElectronMainStorage }

// Export WASM loading helpers
export type { CreateVultisigConfig, WasmPaths } from './wasm'
export { createVultisig, loadWasmModules } from './wasm'
