import initializeMldsa from '@vultisig/lib-mldsa/vs_wasm'
import { prefixErrorWith } from '@vultisig/lib-utils/error/prefixErrorWith'
import { transformError } from '@vultisig/lib-utils/error/transformError'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

export const initializeMldsaLib = memoizeAsync(() =>
  transformError(
    initializeMldsa(),
    prefixErrorWith('Failed to initialize MLDSA lib')
  )
)
