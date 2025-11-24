import { wasmLoaderRegistry } from './registry'

// Self-register Chrome extension WASM loader
wasmLoaderRegistry.register({
  name: 'chrome',
  priority: 110, // Highest priority in Chrome extension

  isSupported: () => {
    return typeof chrome !== 'undefined' && chrome.runtime !== undefined && chrome.runtime.id !== undefined
  },

  loadWasm: async (url: string) => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch WASM from ${url}: ${response.statusText}`)
    }
    return await response.arrayBuffer()
  },

  resolvePath: (filename: string) => {
    // Use chrome.runtime.getURL for extension resources
    return chrome.runtime.getURL(`lib/${filename}`)
  },
})
