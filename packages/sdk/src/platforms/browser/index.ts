/**
 * Browser platform entry point
 *
 * This bundle includes only browser-specific implementations:
 * - BrowserStorage (IndexedDB/localStorage)
 * - BrowserCrypto (Web Crypto API)
 * - BrowserPolyfills (Buffer, process)
 *
 * All Node.js code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses BrowserStorage by default
 * await sdk.initialize()
 * ```
 */

import initDkls from '@lib/dkls/vs_wasm'
import initSchnorr from '@lib/schnorr/vs_schnorr_wasm'
import { initWasm as initWalletCore } from '@trustwallet/wallet-core'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { memoizeAsync } from '../../utils/memoizeAsync'
import { BrowserCrypto } from './crypto'
import { BrowserPolyfills } from './polyfills'
import { BrowserStorage } from './storage'

// Configure crypto
configureCrypto(new BrowserCrypto())

// Configure default storage for Browser
configureDefaultStorage(() => new BrowserStorage())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Browser: init() auto-fetches via import.meta.url (like the simple example)
  const [walletCore] = await Promise.all([initWalletCore(), initDkls(), initSchnorr()])
  walletCoreInstance = walletCore
  return walletCore
})

// Configure WASM on module load
configureWasm(async () => {
  if (walletCoreInstance) return walletCoreInstance
  return initAllWasm()
})

// Re-export entire public API
export * from '../../index'

// Export platform-specific implementations for users to pass to Vultisig
export { BrowserCrypto, BrowserPolyfills, BrowserStorage }

// Export BrowserStorage as the default Storage type for this platform
export { BrowserStorage as Storage }
