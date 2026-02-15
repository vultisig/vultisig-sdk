/**
 * Chrome Extension platform entry point
 *
 * This bundle includes Chrome Extension-specific implementations:
 * - ChromeExtensionStorage (chrome.storage.local API)
 * - ChromeExtensionCrypto (Web Crypto API)
 * - ChromeExtensionPolyfills (Buffer, process via globalThis)
 *
 * Works in all extension contexts: service worker (background),
 * popup, options page, and content scripts.
 *
 * Requirements:
 * - Manifest V3 with "storage" permission
 * - CSP with 'wasm-unsafe-eval' for WASM modules
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses ChromeExtensionStorage by default
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
import { ChromeExtensionCrypto } from './crypto'
import { ChromeExtensionStorage } from './storage'

// Configure crypto
configureCrypto(new ChromeExtensionCrypto())

// Configure default storage for Chrome Extension
configureDefaultStorage(() => new ChromeExtensionStorage())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Extension: init() auto-fetches via import.meta.url (same as browser)
  // Requires 'wasm-unsafe-eval' in manifest.json CSP
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

// Export platform-specific implementations for users who want to customize
export { ChromeExtensionCrypto, ChromeExtensionPolyfills, ChromeExtensionStorage }

// Export ChromeExtensionStorage as the default Storage type for this platform
export { ChromeExtensionStorage as Storage }
