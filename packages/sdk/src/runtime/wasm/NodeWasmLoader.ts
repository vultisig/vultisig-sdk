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

    try {
      // Try primary path (works in production/dist)
      const buffer = await fs.readFile(filePath)

      // Convert Node Buffer to ArrayBuffer (explicit cast to satisfy TypeScript)
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer
    } catch (error) {
      // If file not found, try alternate path (for dev/test environments running from src/)
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        const { join, dirname } = await import('path')

        // Extract the lib/filename part from the path
        const libMatch = filePath.match(/lib\/(.+)$/)
        const relativeLibPath = libMatch ? libMatch[1] : ''

        // Resolve from package root: src/runtime/wasm/NodeWasmLoader.ts -> ../../../lib/
        const altPath = join(
          dirname(fileURLToPath(import.meta.url)),
          '../../../lib',
          relativeLibPath
        )

        const buffer = await fs.readFile(altPath)
        return buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength
        ) as ArrayBuffer
      }
      throw error
    }
  },

  resolvePath: (filename: string) => {
    // Resolve relative to dist/lib directory
    // When bundled, __filename points to dist/index.js, so lib/ is at ./lib/
    return new URL(`./lib/${filename}`, import.meta.url).href
  },
})
