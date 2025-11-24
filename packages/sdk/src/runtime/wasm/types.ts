export type WasmConfig = {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: string | ArrayBuffer
    dkls?: string | ArrayBuffer
    schnorr?: string | ArrayBuffer
  }
}
