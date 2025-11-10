import { detectEnvironment } from '../runtime/environment'

/**
 * Universal WASM loader that works across all environments.
 *
 * Handles the quirk that Node.js fetch() doesn't support file:// URLs,
 * so we need to use fs.readFile() instead.
 *
 * @param urlOrPath - URL, path, or ArrayBuffer containing WASM
 * @returns ArrayBuffer containing the WASM module
 */
export async function loadWasm(
  urlOrPath: string | URL | ArrayBuffer
): Promise<ArrayBuffer> {
  // If already an ArrayBuffer, return it
  if (urlOrPath instanceof ArrayBuffer) {
    return urlOrPath
  }

  const url = typeof urlOrPath === 'string' ? urlOrPath : urlOrPath.toString()
  const env = detectEnvironment()

  // In Node.js environments, handle file:// URLs specially
  if (env === 'node' || env === 'electron-main') {
    return await loadWasmNode(url)
  }

  // In browser/other environments, use fetch
  return await loadWasmBrowser(url)
}

/**
 * Load WASM in Node.js environment.
 * Uses fs.readFile() for file:// URLs since Node's fetch doesn't support them.
 */
async function loadWasmNode(url: string): Promise<ArrayBuffer> {
  const { readFile } = await import('fs/promises')
  const { fileURLToPath } = await import('url')

  let filePath: string

  // Convert file:// URL to filesystem path
  if (url.startsWith('file://')) {
    filePath = fileURLToPath(url)
  } else {
    filePath = url
  }

  // Read the file as buffer
  const buffer = await readFile(filePath)

  // Convert Node Buffer to ArrayBuffer
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  )
}

/**
 * Load WASM in browser environment.
 * Uses standard fetch API.
 */
async function loadWasmBrowser(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch WASM from ${url}: ${response.status} ${response.statusText}`
    )
  }

  return await response.arrayBuffer()
}
