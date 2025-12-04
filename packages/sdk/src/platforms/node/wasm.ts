/**
 * Node.js WASM loader
 *
 * Loads WASM modules from the filesystem for Node.js environments.
 * This bypasses wasm-bindgen's fetch-based loading which doesn't work
 * with file:// URLs in Node.js.
 */
import { readFile } from 'fs/promises'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

import { Vultisig, type VultisigConfig, type WasmModules } from '../../Vultisig'

// ESM-compatible __dirname equivalent
const currentDir = dirname(fileURLToPath(import.meta.url))

/**
 * Path configuration for WASM modules
 */
export type WasmPaths = {
  /** Path to DKLS WASM file (vs_wasm_bg.wasm) */
  dkls?: string
  /** Path to Schnorr WASM file (vs_schnorr_wasm_bg.wasm) */
  schnorr?: string
}

/**
 * Load WASM modules from the filesystem.
 *
 * @param paths - Optional custom paths. Defaults to relative paths from dist/lib/
 * @returns Loaded WASM module bytes
 *
 * @example
 * ```typescript
 * // Use default paths (node_modules location)
 * const wasmModules = await loadWasmModules()
 *
 * // Or provide custom paths
 * const wasmModules = await loadWasmModules({
 *   dkls: '/path/to/vs_wasm_bg.wasm',
 *   schnorr: '/path/to/vs_schnorr_wasm_bg.wasm',
 * })
 * ```
 */
export async function loadWasmModules(paths?: WasmPaths): Promise<WasmModules> {
  // Default paths: relative to dist/ after build
  // In built output, this file is at dist/platforms/node/wasm.js
  // WASM files are copied to dist/lib/
  const libDir = join(currentDir, '../../lib')

  const dklsPath = paths?.dkls ?? join(libDir, 'dkls/vs_wasm_bg.wasm')
  const schnorrPath = paths?.schnorr ?? join(libDir, 'schnorr/vs_schnorr_wasm_bg.wasm')

  const [dklsBuffer, schnorrBuffer] = await Promise.all([readFile(dklsPath), readFile(schnorrPath)])

  return {
    dkls: new Uint8Array(dklsBuffer),
    schnorr: new Uint8Array(schnorrBuffer),
  }
}

/**
 * Configuration for createVultisig factory.
 * Same as VultisigConfig but wasmModules can be paths or pre-loaded bytes.
 */
export type CreateVultisigConfig = Omit<VultisigConfig, 'wasmModules'> & {
  /** WASM paths or pre-loaded bytes. If not provided, uses default paths. */
  wasmModules?: WasmPaths | WasmModules
}

/**
 * Create and initialize a Vultisig SDK instance with WASM modules loaded.
 *
 * This is the recommended way to create a Vultisig instance in Node.js.
 * It handles WASM loading automatically and returns an initialized SDK.
 *
 * @param config - SDK configuration
 * @returns Initialized Vultisig instance
 *
 * @example
 * ```typescript
 * import { createVultisig, FileStorage } from '@vultisig/sdk/node'
 *
 * const sdk = await createVultisig({
 *   storage: new FileStorage({ basePath: '~/.myapp' })
 * })
 *
 * const vault = await sdk.importVault(vaultContent, password)
 * ```
 */
export async function createVultisig(config: CreateVultisigConfig): Promise<Vultisig> {
  let wasmModules: WasmModules

  if (!config.wasmModules) {
    // Load from default paths
    wasmModules = await loadWasmModules()
  } else if ('dkls' in config.wasmModules && config.wasmModules.dkls instanceof ArrayBuffer) {
    // Already loaded bytes
    wasmModules = config.wasmModules as WasmModules
  } else if (
    'dkls' in config.wasmModules &&
    (typeof config.wasmModules.dkls === 'string' || config.wasmModules.dkls === undefined)
  ) {
    // Paths provided
    wasmModules = await loadWasmModules(config.wasmModules as WasmPaths)
  } else {
    // Assume it's already WasmModules (Uint8Array)
    wasmModules = config.wasmModules as WasmModules
  }

  const sdk = new Vultisig({
    ...config,
    wasmModules,
  })

  await sdk.initialize()
  return sdk
}
