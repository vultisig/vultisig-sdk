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
 */

// Platform-specific implementations
// Configure global storage to use Electron Main implementation
import { GlobalStorage } from '../../storage/GlobalStorage'
import { ElectronMainCrypto } from './crypto'
import { ElectronMainPolyfills } from './polyfills'
import { ElectronMainStorage } from './storage'
import { ElectronMainWasmLoader } from './wasm'
GlobalStorage.configure(new ElectronMainStorage())

// Configure global crypto to use Electron Main implementation
import { configureCrypto } from '../../crypto'
configureCrypto(new ElectronMainCrypto())

// Configure WASM to use Electron Main loader
import { WasmManager } from '../../wasm'
const wasmLoader = new ElectronMainWasmLoader()
WasmManager.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for advanced users
export { ElectronMainCrypto, ElectronMainPolyfills, ElectronMainStorage, ElectronMainWasmLoader }
