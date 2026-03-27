import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import initializeDkls from '@vultisig/lib-dkls/vs_wasm'
import initializeSchnorr from '@vultisig/lib-schnorr/vs_schnorr_wasm'
import { prefixErrorWith } from '@vultisig/lib-utils/error/prefixErrorWith'
import { transformError } from '@vultisig/lib-utils/error/transformError'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

const initialize: Record<SignatureAlgorithm, () => Promise<unknown>> = {
  ecdsa: initializeDkls,
  eddsa: initializeSchnorr,
}

export const initializeMpcLib = memoizeAsync((algo: SignatureAlgorithm) =>
  transformError(
    initialize[algo](),
    prefixErrorWith('Failed to initialize MPC lib')
  )
)
