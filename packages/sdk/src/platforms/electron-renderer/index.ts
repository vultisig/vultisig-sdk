/**
 * Electron Renderer process entry point
 *
 * This bundle includes Electron Renderer-specific implementations:
 * - ElectronRendererStorage (IndexedDB/localStorage, same as browser)
 * - ElectronRendererWasmLoader (fetch, same as browser)
 * - ElectronRendererCrypto (Web Crypto API, same as browser)
 * - ElectronRendererPolyfills (Buffer/process, same as browser)
 *
 * All Node.js/main process code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, ElectronRendererStorage } from '@vultisig/sdk/electron-renderer'
 *
 * const sdk = new Vultisig({
 *   storage: new ElectronRendererStorage()
 * })
 * ```
 */

// Platform-specific implementations (re-exported from browser)
// Configure global crypto to use Electron Renderer implementation
import { configureCrypto } from '../../crypto'
import { BrowserPolyfills as ElectronRendererPolyfills } from '../browser/polyfills'
import { BrowserStorage as ElectronRendererStorage } from '../browser/storage'
import { BrowserWasmLoader as ElectronRendererWasmLoader } from '../browser/wasm'
import { ElectronRendererCrypto } from './crypto'
configureCrypto(new ElectronRendererCrypto())

// Configure SharedWasmRuntime to use Electron Renderer loader (process-wide singleton)
import { SharedWasmRuntime } from '../../context/SharedWasmRuntime'
const wasmLoader = new ElectronRendererWasmLoader()
SharedWasmRuntime.configure({
  wasmPaths: {
    dkls: () => wasmLoader.loadDkls(),
    schnorr: () => wasmLoader.loadSchnorr(),
  },
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { ElectronRendererCrypto, ElectronRendererPolyfills, ElectronRendererStorage, ElectronRendererWasmLoader }
