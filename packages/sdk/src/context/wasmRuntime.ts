/**
 * Minimal WASM runtime - configured by platform entry points
 *
 * Platform entry points (browser/index.ts, node/index.ts) register their
 * WASM initialization logic on module load. Services access WASM through
 * the SdkContext.wasmProvider which calls getWalletCore().
 */

let walletCoreGetter: (() => Promise<any>) | null = null

/**
 * Configure the WASM getter (called by platform entry points on module load)
 */
export function configureWasm(getter: () => Promise<any>): void {
  walletCoreGetter = getter
}

/**
 * Get WalletCore instance (lazy-loads on first call)
 * Also initializes DKLS and Schnorr WASM modules.
 */
export function getWalletCore(): Promise<any> {
  if (!walletCoreGetter) {
    throw new Error('WASM not configured. Import from @vultisig/sdk/browser or @vultisig/sdk/node')
  }
  return walletCoreGetter()
}
