import { wasmLoaderRegistry } from './registry'

// Self-register browser WASM loader
wasmLoaderRegistry.register({
  name: 'browser',
  priority: 90,

  isSupported: () => {
    return typeof fetch !== 'undefined' && typeof window !== 'undefined' && typeof document !== 'undefined'
  },

  loadWasm: async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM from ${url}: ${response.statusText}`)
    }
    return await response.arrayBuffer()
  },

  resolvePath: (filename: string) => {
    // Use import.meta.url to resolve relative to this module
    return new URL(filename, import.meta.url).href
  },
})
