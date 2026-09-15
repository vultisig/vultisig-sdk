// jscpd:ignore-start
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
// jscpd:ignore-end

import { initWasm as initWalletCore } from '@trustwallet/wallet-core'
import { initializeMpcLib } from '@vultisig/core-mpc/lib/initialize'
import { initializeMldsaLib } from '@vultisig/core-mpc/mldsa/initializeMldsa'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { configureMpc, runtimeStore } from '@vultisig/mpc-types'
import { WasmMpcEngine } from '@vultisig/mpc-wasm'

import { configureWasm } from '../../context/wasmRuntime'

// The root and narrow bundles share the process registry, including CJS/ESM.
if (!runtimeStore().mpcEngine) configureMpc(new WasmMpcEngine())

// Process-wide memoized WASM initialization
let walletCoreInstance: any

const initAllWasm = memoizeAsync(async () => {
  // Initialize all WASM modules using core's initializeMpcLib
  // The fetch polyfill allows wasm-bindgen to load .wasm from filesystem
  const [walletCore] = await Promise.all([
    initWalletCore(),
    initializeMpcLib('ecdsa'), // DKLS - via core's single source of truth
    initializeMpcLib('eddsa'), // Schnorr - via core's single source of truth
    initializeMldsaLib(), // ML-DSA - post-quantum signatures
  ])
  walletCoreInstance = walletCore
  return walletCore
})

// Configure WASM on module load
if (!runtimeStore().walletCore)
  configureWasm(async () => {
    if (walletCoreInstance) return walletCoreInstance
    return initAllWasm()
  })
