/**
 * Electron Main Process platform entry point
 *
 * This bundle includes Electron main process-specific implementations:
 * - FileStorage (filesystem via Node.js APIs)
 * - ElectronMainCrypto (native webcrypto)
 * - ElectronMainPolyfills (minimal)
 *
 * All browser/renderer code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * // In Electron main process
 * import { Vultisig, Chain } from '@vultisig/sdk/electron/main'
 *
 * const sdk = new Vultisig()
 * await sdk.initialize()
 * ```
 */

import '../node/initializePrep'

// Now safe to import modules that may trigger WASM initialization
import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureCrypto } from '../../crypto'
import { ElectronMainCrypto } from './crypto'
import { ElectronMainPolyfills } from './polyfills'
import { FileStorage } from './storage'

// Configure crypto
configureCrypto(new ElectronMainCrypto())

// Configure default storage for Electron main
configureDefaultStorage(() => new FileStorage())

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { ElectronMainCrypto, ElectronMainPolyfills, FileStorage }

// Export FileStorage as the default Storage type for this platform
export { FileStorage as Storage }
