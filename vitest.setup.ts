/**
 * Vitest setup file
 * Sets up global test environment including WASM file access
 */

import { vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// Mock fetch for WASM file loading in tests
global.fetch = vi.fn((url: string | URL | Request) => {
  const urlString = url.toString()
  
  if (urlString.endsWith('.wasm')) {
    try {
      // Try to load WASM files from the file system
      let wasmPath: string
      
      if (urlString.includes('wallet-core.wasm')) {
        wasmPath = join(__dirname, 'node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm')
      } else if (urlString.includes('vs_wasm_bg.wasm')) {
        wasmPath = join(__dirname, 'lib/dkls/vs_wasm_bg.wasm')
      } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
        wasmPath = join(__dirname, 'lib/schnorr/vs_schnorr_wasm_bg.wasm')
      } else {
        throw new Error(`Unknown WASM file: ${urlString}`)
      }
      
      const wasmBuffer = readFileSync(wasmPath)
      const arrayBuffer = wasmBuffer.buffer.slice(wasmBuffer.byteOffset, wasmBuffer.byteOffset + wasmBuffer.byteLength)
      
      console.log(`Loading WASM: ${urlString}`)
      console.log(`File path: ${wasmPath}`)
      console.log(`Buffer size: ${wasmBuffer.length}`)
      console.log(`ArrayBuffer size: ${arrayBuffer.byteLength}`)
      
      // Return a proper Response object that mimics fetch response
      const response = new Response(arrayBuffer, {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/wasm'
        })
      })
      
      return Promise.resolve(response)
    } catch (error) {
      console.warn(`Failed to load WASM file ${urlString}:`, error)
      return Promise.reject(new Error(`Failed to load WASM file: ${urlString}`))
    }
  }
  
  // For non-WASM requests, return a basic mock
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found')
  } as Response)
})

// WebAssembly should be available in jsdom environment
// If not, we'll let the test fail with a clear error

// Ensure Buffer.from returns Uint8Array for compatibility with bip32
if (typeof global !== 'undefined' && global.Buffer) {
  const originalBufferFrom = global.Buffer.from
  global.Buffer.from = function(data: any, encoding?: any): any {
    const result = originalBufferFrom.call(this, data, encoding)
    // For hex strings, return Uint8Array instead of Buffer
    if (typeof data === 'string' && encoding === 'hex') {
      return new Uint8Array(result.buffer, result.byteOffset, result.byteLength)
    }
    return result
  }
}

// Mock File API for tests
if (typeof global !== 'undefined') {
  // Always override File constructor to ensure our mock is used
  const OriginalFile = global.File

  global.File = class MockFile {
    name: string
    lastModified: number
    size: number
    type: string
    private data: Uint8Array

    constructor(bits: (Uint8Array | Buffer | string)[], filename: string, options?: { type?: string }) {
      this.name = filename
      this.lastModified = Date.now()
      this.type = options?.type || ''

      const firstBit = bits[0]
      if (firstBit instanceof Uint8Array) {
        this.data = firstBit
      } else if (Buffer.isBuffer(firstBit)) {
        this.data = new Uint8Array(firstBit)
      } else if (typeof firstBit === 'string') {
        this.data = new TextEncoder().encode(firstBit)
      } else {
        this.data = new Uint8Array()
      }
      this.size = this.data.length
    }

    arrayBuffer(): Promise<ArrayBuffer> {
      return Promise.resolve(this.data.buffer.slice())
    }

    text(): Promise<string> {
      return Promise.resolve(new TextDecoder().decode(this.data))
    }

    slice(start?: number, end?: number): Blob {
      const sliced = this.data.slice(start, end)
      return new Blob([sliced], { type: this.type })
    }
  }

  // Copy any static methods from original File if they exist
  if (OriginalFile) {
    Object.setPrototypeOf(global.File, OriginalFile)
  }
}

// Set up console to show more detailed logs during tests
console.log('Vitest setup: WASM environment configured')
