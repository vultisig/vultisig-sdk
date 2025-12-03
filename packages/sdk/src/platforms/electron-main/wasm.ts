/**
 * Electron Main WASM loader
 *
 * Loads WASM modules from the filesystem for Electron Main process.
 * Same as Node.js since Electron Main has access to Node APIs.
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
 */
export async function loadWasmModules(paths?: WasmPaths): Promise<WasmModules> {
  // Default paths: relative to dist/ after build
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
 */
export type CreateVultisigConfig = Omit<VultisigConfig, 'wasmModules'> & {
  wasmModules?: WasmPaths | WasmModules
}

/**
 * Create and initialize a Vultisig SDK instance with WASM modules loaded.
 *
 * @param config - SDK configuration
 * @returns Initialized Vultisig instance
 */
export async function createVultisig(config: CreateVultisigConfig): Promise<Vultisig> {
  let wasmModules: WasmModules

  if (!config.wasmModules) {
    wasmModules = await loadWasmModules()
  } else if ('dkls' in config.wasmModules && config.wasmModules.dkls instanceof ArrayBuffer) {
    wasmModules = config.wasmModules as WasmModules
  } else if (
    'dkls' in config.wasmModules &&
    (typeof config.wasmModules.dkls === 'string' || config.wasmModules.dkls === undefined)
  ) {
    wasmModules = await loadWasmModules(config.wasmModules as WasmPaths)
  } else {
    wasmModules = config.wasmModules as WasmModules
  }

  const sdk = new Vultisig({
    ...config,
    wasmModules,
  })

  await sdk.initialize()
  return sdk
}
