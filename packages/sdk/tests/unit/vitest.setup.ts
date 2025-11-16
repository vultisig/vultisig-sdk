/**
 * Global Vitest setup file
 * Sets up WASM file loading for all tests in Node.js environment
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { vi } from 'vitest'

// Mock getCoinBalance to prevent real API calls during testing
vi.mock('@core/chain/coin/balance', () => ({
  getCoinBalance: vi.fn().mockResolvedValue('1000000000'), // Mock balance as string (1 BTC or 10 ETH equivalent)
}))

// Setup global fetch mock for WASM file loading in Node.js environment
const originalFetch = global.fetch

global.fetch = async (url: string | URL | Request) => {
  const urlString = url.toString()

  console.log('🔍 Vitest fetch called with URL:', urlString)

  if (urlString.includes('.wasm')) {
    console.log('📦 Loading WASM file:', urlString)
    // Try to load from node_modules or lib directories
    let wasmPath: string | undefined = undefined

    if (urlString.includes('wallet-core.wasm')) {
      wasmPath = join(
        __dirname,
        '../../../../node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'
      )
    } else if (urlString.includes('vs_wasm_bg.wasm')) {
      wasmPath = join(
        __dirname,
        '../../../../packages/lib/dkls/vs_wasm_bg.wasm'
      )
    } else if (urlString.includes('vs_schnorr_wasm_bg.wasm')) {
      wasmPath = join(
        __dirname,
        '../../../../packages/lib/schnorr/vs_schnorr_wasm_bg.wasm'
      )
    } else {
      // For any other WASM files, try to load from the filesystem
      const fs = await import('fs')
      const path = await import('path')

      // Extract filename and try common locations
      const filename = urlString.split('/').pop() || ''
      const possiblePaths = [
        path.join(
          __dirname,
          '../../../../node_modules/@trustwallet/wallet-core/dist/lib/',
          filename
        ),
        path.join(__dirname, '../../../../packages/lib/dkls/', filename),
        path.join(__dirname, '../../../../packages/lib/schnorr/', filename),
        path.join(
          __dirname,
          '../../../../src/node_modules/@trustwallet/wallet-core/dist/lib/',
          filename
        ),
      ]

      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          wasmPath = testPath
          break
        }
      }

      if (!wasmPath) {
        throw new Error(`WASM file not found: ${urlString}`)
      }
    }

    console.log('📁 Trying to load WASM from:', wasmPath)
    try {
      const wasmBuffer = readFileSync(wasmPath)
      console.log(
        '✅ WASM file loaded successfully, size:',
        wasmBuffer.length,
        'bytes'
      )
      const arrayBuffer = wasmBuffer.buffer.slice(
        wasmBuffer.byteOffset,
        wasmBuffer.byteOffset + wasmBuffer.byteLength
      )

      return new Response(arrayBuffer, {
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/wasm',
        }),
      })
    } catch (error) {
      // Try fallback paths if primary path fails
      const fallbackPaths = [
        join(__dirname, '../../../../packages/lib/dkls/vs_wasm_bg.wasm'),
        join(
          __dirname,
          '../../../../packages/lib/schnorr/vs_schnorr_wasm_bg.wasm'
        ),
        join(
          __dirname,
          '../../../../node_modules/@trustwallet/wallet-core/dist/lib/wallet-core.wasm'
        ),
      ]

      for (const fallbackPath of fallbackPaths) {
        if (urlString.includes(fallbackPath.split('/').pop() || '')) {
          try {
            const wasmBuffer = readFileSync(fallbackPath)
            const arrayBuffer = wasmBuffer.buffer.slice(
              wasmBuffer.byteOffset,
              wasmBuffer.byteOffset + wasmBuffer.byteLength
            )
            return new Response(arrayBuffer, {
              status: 200,
              statusText: 'OK',
              headers: new Headers({
                'Content-Type': 'application/wasm',
              }),
            })
          } catch {
            continue
          }
        }
      }

      throw error
    }
  }

  // For non-WASM requests, use original fetch if available
  if (originalFetch) {
    return originalFetch(url)
  }

  // Fallback for non-WASM requests when no original fetch
  return Promise.resolve({
    ok: false,
    status: 404,
    text: () => Promise.resolve('Not found'),
  } as Response)
}

/**
 * Polyfills for Node.js test environment
 * Add File and Blob support for tests that need them
 */
if (typeof File === 'undefined') {
  // @ts-ignore - Adding File polyfill
  global.File = class File {
    name: string
    type: string
    lastModified: number
    size: number
    _buffer: Buffer

    constructor(bits: BlobPart[], filename: string, options?: FilePropertyBag) {
      this.name = filename
      this.type = options?.type || ''
      this.lastModified = options?.lastModified || Date.now()

      // Combine all bits into a single buffer
      const buffers: Buffer[] = []
      for (const bit of bits) {
        if (bit instanceof Buffer) {
          buffers.push(bit)
        } else if (bit instanceof Uint8Array) {
          buffers.push(Buffer.from(bit))
        } else if (typeof bit === 'string') {
          buffers.push(Buffer.from(bit))
        } else if ((bit as any)?.constructor?.name === 'Blob') {
          // Handle Blob
          const blobBuffer = (bit as any)._buffer
          if (blobBuffer) {
            buffers.push(blobBuffer)
          }
        }
      }
      this._buffer =
        buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
      this.size = this._buffer.length
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return this._buffer.buffer.slice(
        this._buffer.byteOffset,
        this._buffer.byteOffset + this._buffer.byteLength
      ) as ArrayBuffer
    }

    async text(): Promise<string> {
      return this._buffer.toString('utf-8')
    }
  }
}

if (typeof Blob === 'undefined') {
  // @ts-ignore - Adding Blob polyfill
  global.Blob = class Blob {
    type: string
    size: number
    _buffer: Buffer

    constructor(bits: BlobPart[], options?: BlobPropertyBag) {
      this.type = options?.type || ''

      const buffers: Buffer[] = []
      for (const bit of bits) {
        if (bit instanceof Buffer) {
          buffers.push(bit)
        } else if (bit instanceof Uint8Array) {
          buffers.push(Buffer.from(bit))
        } else if (typeof bit === 'string') {
          buffers.push(Buffer.from(bit))
        }
      }
      this._buffer =
        buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
      this.size = this._buffer.length
    }

    async arrayBuffer(): Promise<ArrayBuffer> {
      return this._buffer.buffer.slice(
        this._buffer.byteOffset,
        this._buffer.byteOffset + this._buffer.byteLength
      ) as ArrayBuffer
    }

    async text(): Promise<string> {
      return this._buffer.toString('utf-8')
    }
  }
}

console.log(
  'Vitest setup: Global WASM loading configured for Node.js environment'
)
console.log('✅ File polyfill:', typeof File !== 'undefined')
console.log('✅ Blob polyfill:', typeof Blob !== 'undefined')
