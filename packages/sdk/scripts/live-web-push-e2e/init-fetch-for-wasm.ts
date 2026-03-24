/**
 * Install fetch wrapper for file:// WASM loads before any SDK/WASM imports.
 * Import this module first from bootstrap-wasm-for-live-push.ts.
 */
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

if (typeof globalThis.crypto === 'undefined') {
  // @ts-expect-error -- Node webcrypto
  globalThis.crypto = webcrypto
}

const wasmFetchHandler = async (input: RequestInfo | URL, _init?: RequestInit): Promise<Response | null> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

  if (url.endsWith('.wasm') && url.startsWith('file://')) {
    try {
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
    } catch (error) {
      console.error(`Failed to load WASM file: ${url}`, error)
      throw error
    }
  }

  return null
}

const originalFetch = globalThis.fetch

const wrappedFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const wasmResponse = await wasmFetchHandler(input, undefined)
  if (wasmResponse) return wasmResponse

  const currentFetch = globalThis.fetch === wrappedFetch ? originalFetch : globalThis.fetch
  return currentFetch(input as RequestInfo | URL, init)
}

globalThis.fetch = wrappedFetch as typeof fetch
