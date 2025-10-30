import { SignatureAlgorithm } from '../../chain/signing/SignatureAlgorithm'
import initializeDkls from '../../../lib/dkls/vs_wasm'
import initializeSchnorr from '../../../lib/schnorr/vs_schnorr_wasm'
import { prefixErrorWith } from '../../../lib/utils/error/prefixErrorWith'
import { transformError } from '../../../lib/utils/error/transformError'
import { memoizeAsync } from '../../../lib/utils/memoizeAsync'

// Type for the init input parameter (URL, Request, or module)
type WasmInitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module

const initialize: Record<
  SignatureAlgorithm,
  (wasmUrl?: WasmInitInput) => Promise<unknown>
> = {
  ecdsa: initializeDkls,
  eddsa: initializeSchnorr,
}

export const initializeMpcLib = memoizeAsync(
  (algo: SignatureAlgorithm, wasmUrl?: WasmInitInput) =>
    transformError(
      initialize[algo](wasmUrl),
      prefixErrorWith('Failed to initialize MPC lib')
    )
)
