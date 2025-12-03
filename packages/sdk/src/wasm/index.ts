/**
 * WASM management exports
 *
 * WASM modules are managed automatically:
 * - WalletCore: SharedWasmRuntime (lazy loaded on first use)
 * - DKLS/Schnorr: core's initializeMpcLib() (lazy loaded on first MPC operation)
 *
 * No configuration needed - just import from the platform entry point.
 */

// No exports needed - WASM is managed automatically
