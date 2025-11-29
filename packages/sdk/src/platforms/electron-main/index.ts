/**
 * Electron Main process entry point
 *
 * This bundle includes Electron Main-specific implementations:
 * - ElectronMainStorage (filesystem with userData path)
 * - ElectronMainWasmLoader (fs.readFile)
 * - ElectronMainCrypto (native crypto)
 * - ElectronMainPolyfills (none needed)
 *
 * All browser/renderer code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, ElectronMainStorage } from '@vultisig/sdk/electron-main'
 *
 * const sdk = new Vultisig({
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
import { ElectronMainWasmLoader } from './wasm'
configureCrypto(new ElectronMainCrypto())

// Configure SharedWasmRuntime to use Electron Main loader (process-wide singleton)
import { SharedWasmRuntime } from '../../context/SharedWasmRuntime'
const wasmLoader = new ElectronMainWasmLoader()
SharedWasmRuntime.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { ElectronMainCrypto, ElectronMainPolyfills, ElectronMainStorage, ElectronMainWasmLoader }
