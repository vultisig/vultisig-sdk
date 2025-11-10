import { detectEnvironment, type Environment } from '../runtime/environment'

/**
 * Get the appropriate WASM file path based on the current runtime environment.
 *
 * @param filename - The WASM filename (e.g., 'vs_wasm_bg.wasm')
 * @param customPath - Optional custom path to override the default
 * @returns The path or URL to load the WASM file
 */
export function getWasmPath(filename: string, customPath?: string): string {
  // If custom path is provided, use it
  if (customPath) {
    return customPath
  }

  const env = detectEnvironment()

  return getDefaultWasmPath(filename, env)
}

/**
 * Get the default WASM path for a given environment.
 *
 * @param filename - The WASM filename
 * @param env - The detected environment
 * @returns The appropriate path for the environment
 */
function getDefaultWasmPath(filename: string, env: Environment): string {
  switch (env) {
    case 'node':
    case 'electron-main': {
      // In Node.js/Electron main, use file:// URL relative to the module
      // Path structure for published package:
      // - node_modules/@vultisig/sdk/dist/wasm/index.js
      // - node_modules/@vultisig/sdk/lib/dkls/vs_wasm_bg.wasm
      // - From dist/wasm to lib: ../../lib/
      const relativePath = `../../lib/${filename}`
      return new URL(relativePath, import.meta.url).href
    }

    case 'browser':
    case 'electron-renderer':
      // In browser/Electron renderer, use import.meta.url
      // This works if WASM files are bundled alongside JS
      return new URL(filename, import.meta.url).href

    case 'chrome-extension':
    case 'chrome-extension-sw':
      // Chrome extensions need chrome-extension:// protocol
      // WASM files should be in lib/ folder in the extension
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        return chrome.runtime.getURL(`lib/${filename}`)
      }
      throw new Error('Chrome extension runtime not available')

    case 'worker':
      // Web Workers can use import.meta.url
      return new URL(filename, import.meta.url).href

    case 'unknown':
    default:
      // Fallback: try import.meta.url
      console.warn(
        `Unknown environment detected, attempting default WASM loading for: ${filename}`
      )
      return new URL(filename, import.meta.url).href
  }
}

/**
 * Helper to get WASM path for a specific module.
 * Handles the full path structure for the SDK's WASM files.
 */
export function getDklsWasmPath(customPath?: string): string {
  return getWasmPath('dkls/vs_wasm_bg.wasm', customPath)
}

export function getSchnorrWasmPath(customPath?: string): string {
  return getWasmPath('schnorr/vs_schnorr_wasm_bg.wasm', customPath)
}

/**
 * For environments that need to pre-load WASM as ArrayBuffer
 * (e.g., React Native, certain bundlers).
 *
 * @param path - Path or URL to the WASM file
 * @returns Promise resolving to ArrayBuffer
 */
export async function loadWasmAsBuffer(path: string): Promise<ArrayBuffer> {
  const env = detectEnvironment()

  if (env === 'node' || env === 'electron-main') {
    // In Node.js, use fs to read the file
    const fs = await import('fs/promises')
    const { fileURLToPath } = await import('url')

    // Convert file:// URL to path if needed
    const filePath = path.startsWith('file://') ? fileURLToPath(path) : path
    const buffer = await fs.readFile(filePath)

    // Convert Node Buffer to ArrayBuffer
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength
    )
    return arrayBuffer as ArrayBuffer
  } else {
    // In browser environments, use fetch
    const response = await fetch(path)
    if (!response.ok) {
      throw new Error(
        `Failed to load WASM from ${path}: ${response.statusText}`
      )
    }
    return response.arrayBuffer()
  }
}
