/**
 * Integration Test Setup
 * Configures WASM loading for Node.js environment
 */

import { webcrypto } from 'crypto'
import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'

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
 *
 * IMPORTANT: We save a reference and wrap fetch dynamically so it works even if fetch
 * gets replaced later (e.g., by server mocks)
 */
const wasmFetchHandler = async (
  input: RequestInfo | URL,
  _init?: RequestInit
): Promise<Response | null> => {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

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
      // This ensures instanceof Response check works properly
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
const wrappedFetch = async function (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  // Try WASM handler first
  const wasmResponse = await wasmFetchHandler(input, undefined)
  if (wasmResponse) return wasmResponse

  // Delegate to current globalThis.fetch (which might be a mock)
  // We check globalThis.fetch at call time, not setup time
  const currentFetch =
    globalThis.fetch === wrappedFetch ? originalFetch : globalThis.fetch
  return currentFetch(input as any, init)
}

// Install the wrapper
globalThis.fetch = wrappedFetch as any

console.log('✅ Integration test WASM polyfill loaded')
console.log('📦 WASM files will be loaded from filesystem using fs.readFile()')
