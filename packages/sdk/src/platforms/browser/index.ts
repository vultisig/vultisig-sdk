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

import './preamble'

import { initWasm as initWalletCore } from '@trustwallet/wallet-core'
import initDkls from '@vultisig/lib-dkls/vs_wasm'
import initMldsa from '@vultisig/lib-mldsa/vs_wasm'
import initSchnorr from '@vultisig/lib-schnorr/vs_schnorr_wasm'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { configureMpc } from '@vultisig/mpc-types'
import { WasmMpcEngine } from '@vultisig/mpc-wasm'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { BrowserCrypto } from './crypto'
import { BrowserPolyfills } from './polyfills'
import { BrowserStorage } from './storage'

// Configure MPC engine (WASM for browser)
configureMpc(new WasmMpcEngine())

// Configure crypto
configureCrypto(new BrowserCrypto())

// Configure default storage for Browser
configureDefaultStorage(() => new BrowserStorage())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Browser: init() auto-fetches via import.meta.url (like the simple example)
  const [walletCore] = await Promise.all([initWalletCore(), initDkls(), initSchnorr(), initMldsa()])
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

// sdk#1840: the shared chain tx-builder namespace. `src/index.ts` documents the Cosmos
// signing primitives as shipping via `chains.cosmos.buildCosmosStakingTx` "from the
// platform-specific entry point", but only the React Native entry actually exposed it —
// so Node/browser/electron/chrome consumers had to deep-import or re-glue it.
//
// It lives under platforms/react-native/ for historical reasons only: the tree has no
// react-native or expo import anywhere in it, just @noble/@scure crypto. The root entry
// already reaches into the same path for `buildCosmosWasmExecuteTx`.
export { chains } from '../react-native/chains'
