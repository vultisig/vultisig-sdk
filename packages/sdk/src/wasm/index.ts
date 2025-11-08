/**
 * WASM utilities module
 * Handles initialization and management of WASM modules
 */

export { WASMManager } from './WASMManager'

// Re-export WASM initialization functions
export { initializeMpcLib } from '@core/mpc/lib/initialize'

// WASM module types - stub for compilation
export type WASMConfig = {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: string
    dkls?: string
    schnorr?: string
  }
}
