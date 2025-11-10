/**
 * E2E-specific Vitest setup file
 *
 * IMPORTANT: This file DOES NOT mock getCoinBalance or any blockchain APIs.
 * E2E tests need to make real network calls to production blockchain RPCs.
 *
 * Notes:
 * - WASM loading is handled by the SDK's built-in wasmLoader (uses fs.readFile() in Node.js)
 * - Node.js 18+ has native fetch support for HTTP requests
 * - We only provide File/Blob polyfills for vault file loading in tests
 */

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
      this._buffer = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
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
      this._buffer = buffers.length > 0 ? Buffer.concat(buffers) : Buffer.alloc(0)
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
  'Vitest E2E setup: Global WASM loading configured for Node.js environment'
)
console.log('✅ File polyfill:', typeof File !== 'undefined')
console.log('✅ Blob polyfill:', typeof Blob !== 'undefined')
console.log('🌐 Real API calls ENABLED (getCoinBalance NOT mocked)')
