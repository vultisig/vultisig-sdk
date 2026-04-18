import { SignatureAlgorithm } from '@vultisig/core-chain/signing/SignatureAlgorithm'
import { ensureMpcEngine } from '@vultisig/mpc-types'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { prefixErrorWith } from '@vultisig/lib-utils/error/prefixErrorWith'
import { transformError } from '@vultisig/lib-utils/error/transformError'

const initializeEngine = memoizeAsync(() =>
  ensureMpcEngine().then(engine =>
    transformError(
      engine.initialize(),
      prefixErrorWith('Failed to initialize MPC lib')
    )
  )
)

export const initializeMpcLib = (_algo: SignatureAlgorithm) =>
  initializeEngine()
