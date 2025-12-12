/**
 * Node.js platform entry point
 *
 * This bundle includes only Node.js-specific implementations:
 * - FileStorage (filesystem)
 * - NodeCrypto (native crypto)
 * - NodePolyfills (minimal)
 *
 * All browser code is excluded at build time.
 *
 * Usage:
 * ```typescript
 * import { Vultisig, Chain } from '@vultisig/sdk'
 *
 * const sdk = new Vultisig()  // Uses FileStorage by default
 * await sdk.initialize()
 * ```
 */

import { webcrypto } from 'crypto'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'

/**
 * Crypto Polyfill for Node.js
 *
 * The WASM MPC libraries (DKLS, Schnorr) use crypto.getRandomValues() internally
 * via wasm-bindgen. Node.js 18+ has webcrypto but it's not on globalThis by default.
 */
if (typeof globalThis.crypto === 'undefined') {
  ;(globalThis as any).crypto = webcrypto
}

/**
 * WASM Fetch Polyfill for Node.js
 *
 * Node.js fetch() doesn't support file:// URLs.
 * wasm-bindgen's init() without bytes uses: fetch(new URL('*.wasm', import.meta.url))
 *
 * This polyfill intercepts file:// .wasm requests and loads from filesystem.
 * Must be installed BEFORE any WASM initialization (including imports that may trigger it).
 */
const originalFetch = globalThis.fetch

const wasmFetchPolyfill = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // Intercept file:// .wasm requests
  if (url.endsWith('.wasm') && url.startsWith('file://')) {
    const filePath = fileURLToPath(url)
    const buffer = await readFile(filePath)
    const uint8Array = new Uint8Array(buffer)
    const arrayBuffer = uint8Array.buffer
    const blob = new Blob([arrayBuffer], { type: 'application/wasm' })
    return new Response(blob, {
      status: 200,
      statusText: 'OK',
      headers: { 'Content-Type': 'application/wasm' },
    })
  }

  // Pass through to original fetch
  return originalFetch(input as any, init)
}

// Install polyfill FIRST (before any imports that might trigger WASM init)
globalThis.fetch = wasmFetchPolyfill as any

// Now safe to import modules that may trigger WASM initialization
import { initializeMpcLib } from '@core/mpc/lib/initialize'
import { memoizeAsync } from '@lib/utils/memoizeAsync'
import { initWasm as initWalletCore } from '@trustwallet/wallet-core'

import { configureDefaultStorage } from '../../context/defaultStorage'
import { configureWasm } from '../../context/wasmRuntime'
import { configureCrypto } from '../../crypto'
import { NodeCrypto } from './crypto'
import { NodePolyfills } from './polyfills'
import { FileStorage } from './storage'

// Configure crypto
configureCrypto(new NodeCrypto())

// Configure default storage for Node
configureDefaultStorage(() => new FileStorage())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Initialize all WASM modules using core's initializeMpcLib
  // The fetch polyfill allows wasm-bindgen to load .wasm from filesystem
  const [walletCore] = await Promise.all([
    initWalletCore(),
    initializeMpcLib('ecdsa'), // DKLS - via core's single source of truth
    initializeMpcLib('eddsa'), // Schnorr - via core's single source of truth
  ])
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
export { FileStorage, NodeCrypto, NodePolyfills }

// Backwards-compatible alias
export { FileStorage as NodeStorage }

// Export FileStorage as the default Storage type for this platform
export { FileStorage as Storage }
