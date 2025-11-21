import { wasmLoaderRegistry } from './registry'

// Self-register Node.js WASM loader
wasmLoaderRegistry.register({
  name: 'node',
  priority: 100,

  isSupported: () => {
    return (
      typeof process !== 'undefined' &&
      process.versions?.node !== undefined &&
      typeof window === 'undefined'
    )
  },

  loadWasm: async (url: string) => {
    // Dynamic import to avoid bundler issues
    const fs = await import('fs/promises')
    const { fileURLToPath } = await import('url')

    // Convert file:// URL to filesystem path
    const filePath = url.startsWith('file://') ? fileURLToPath(url) : url

    // Read file as Buffer
    const buffer = await fs.readFile(filePath)

    // Convert Node Buffer to ArrayBuffer (explicit cast to satisfy TypeScript)
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer
  },

  resolvePath: (filename: string) => {
    // Resolve relative to package root lib directory
    // From dist/runtime/wasm/ -> ../../../lib/
    return new URL(`../../../lib/${filename}`, import.meta.url).href
  },
})
