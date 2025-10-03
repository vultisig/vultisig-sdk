import { SignatureAlgorithm } from '../../chain/signing/SignatureAlgorithm'
import initializeDkls from '../../../lib/dkls/vs_wasm'
import initializeSchnorr from '../../../lib/schnorr/vs_schnorr_wasm'
import { prefixErrorWith } from '../../../lib/utils/error/prefixErrorWith'
import { transformError } from '../../../lib/utils/error/transformError'
import { memoizeAsync } from '../../../lib/utils/memoizeAsync'

const initialize: Record<SignatureAlgorithm, (path?: string) => Promise<unknown>> = {
  ecdsa: initializeDkls,
  eddsa: initializeSchnorr,
}

export const initializeMpcLib = memoizeAsync((algo: SignatureAlgorithm, path?: string) =>
  transformError(
    initialize[algo](path),
    prefixErrorWith('Failed to initialize MPC lib')
  )
)
