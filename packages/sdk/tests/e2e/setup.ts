/**
 * E2E Test Setup File
 *
 * This setup file is specifically for E2E tests and makes real network calls
 * to production blockchain RPCs.
 *
 * WASM loading is handled by the WASM fetch polyfill below.
 */

import { vi } from 'vitest'

// Mock @lifi/sdk to avoid @solana/web3.js v2/v1 conflict
// The SDK uses v2.0 while @lifi/sdk requires v1.x (PublicKey export)
// Note: This prevents LiFi swap routes from working in E2E tests
// Other swap providers (THORChain, 1inch, etc.) will still work
vi.mock('@lifi/sdk', () => ({
  ChainId: {
    ETH: 1,
    POL: 137,
    BSC: 56,
    AVA: 43114,
    ARB: 42161,
    OPT: 10,
    BAS: 8453,
    SOL: 1151111081099710,
  },
  getQuote: vi.fn(),
  getRoutes: vi.fn(),
  createConfig: vi.fn(() => ({})),
  EVM: vi.fn(),
}))

import { webcrypto } from 'crypto'
import { config } from 'dotenv'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

/**
 * Load environment variables from .env file
 * This allows test vault credentials to be stored securely outside of git
 */
const envPath = resolve(__dirname, '.env')
if (existsSync(envPath)) {
  config({ path: envPath })
  console.log('✅ Loaded .env file from:', envPath)
  console.log('   TEST_VAULT_PATH:', process.env.TEST_VAULT_PATH ? 'SET' : 'NOT SET')
  console.log('   TEST_VAULT_PASSWORD:', process.env.TEST_VAULT_PASSWORD ? 'SET' : 'NOT SET')
} else {
  console.log('ℹ️  No .env file found, using default test vault or exported env vars')
}

/**
 * Polyfill for Web Crypto API in Node.js
 * The SDK uses crypto.randomUUID() which is available in Node.js via webcrypto
 */
if (typeof globalThis.crypto === 'undefined') {
  // @ts-ignore - polyfill crypto
  globalThis.crypto = webcrypto
}

/**
 * Polyfill for loading WASM files in Node.js test environment
 * Node.js 18's fetch() doesn't support file:// URLs ("not implemented... yet...")
 * This polyfill intercepts fetch calls for .wasm files and loads them from the filesystem
 */
const wasmFetchHandler = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response | null> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  // Check if this is a WASM file request with file:// protocol
  if (url.endsWith('.wasm') && url.startsWith('file://')) {
    try {
      // Convert file:// URL to filesystem path
      const filePath = fileURLToPath(url)

      // Read the WASM file from filesystem
      const buffer = await readFile(filePath)

      // Convert Node.js Buffer to ArrayBuffer properly
      const uint8Array = new Uint8Array(buffer)
      const arrayBuffer = uint8Array.buffer

      // Create a proper Response object using the Blob constructor
      const blob = new Blob([arrayBuffer], { type: 'application/wasm' })
      return new Response(blob, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/wasm' },
      })
    } catch (error) {
      console.error(`❌ Failed to load WASM file: ${url}`, error)
      throw error
    }
  }

  return null
}

// Store original fetch
const originalFetch = globalThis.fetch

// Create wrapper that handles WASM and delegates to whatever fetch is currently set
const wrappedFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  // Try WASM handler first
  const wasmResponse = await wasmFetchHandler(input, undefined)
  if (wasmResponse) return wasmResponse

  // Delegate to current globalThis.fetch (which might be a mock)
  const currentFetch = globalThis.fetch === wrappedFetch ? originalFetch : globalThis.fetch
  return currentFetch(input as any, init)
}

// Install the wrapper
globalThis.fetch = wrappedFetch as any

/**
 * Configure crypto for E2E tests
 */
import { configureCrypto } from '../../src/crypto'
import { NodeCrypto } from '../../src/platforms/node/crypto'

configureCrypto(new NodeCrypto())

// Note: DKLS and Schnorr WASM modules are handled automatically by core's
// initializeMpcLib() using wasm-bindgen's import.meta.url. The fetch polyfill
// above allows wasm-bindgen to load .wasm files from the filesystem.

console.log('✅ E2E test setup loaded')
console.log('🌐 Real network calls ENABLED (no API mocks)')
console.log('📡 Tests will query production blockchain RPCs')
