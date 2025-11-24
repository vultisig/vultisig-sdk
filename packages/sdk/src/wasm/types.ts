export type WasmConfig = {
  autoInit?: boolean
  wasmPaths?: {
    walletCore?: string | ArrayBuffer | (() => Promise<ArrayBuffer>)
    dkls?: string | ArrayBuffer | (() => Promise<ArrayBuffer>)
    schnorr?: string | ArrayBuffer | (() => Promise<ArrayBuffer>)
  }
}
