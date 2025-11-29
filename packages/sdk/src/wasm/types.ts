export type WasmConfig = {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: () => Promise<ArrayBuffer>
    dkls?: () => Promise<ArrayBuffer>
    schnorr?: () => Promise<ArrayBuffer>
  }
}
