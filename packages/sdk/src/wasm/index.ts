/**
 * WASM utilities module
 * Handles initialization and management of WASM modules
 * Supports cross-platform loading (Node.js, browser, Electron, Chrome extension)
 */

export { loadWasm } from './wasmLoader'
export { type WASMConfig, WASMManager } from './WASMManager'
export { getDklsWasmPath, getSchnorrWasmPath, getWasmPath } from './wasmPaths'

// Re-export WASM initialization functions for advanced users
export { initializeMpcLib } from '@core/mpc/lib/initialize'
