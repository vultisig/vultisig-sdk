import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { Chain } from '../../Chain'

// `not_found` is terminal-ish: the node affirmatively has no record of the hash
// (never seen it), as opposed to `pending` which means "known/plausibly in-flight,
// no final receipt yet". Keeping them distinct stops a typo'd or dropped hash from
// being polled as `pending` forever. Resolvers that can't tell the two apart may
// still return `pending` (with `isKnown: false`).
type TxStatus = 'pending' | 'success' | 'error' | 'not_found'

export type TxReceiptInfo = {
  feeAmount: bigint
  feeDecimals: number
  feeTicker: string
}

export type TxStatusResult = {
  status: TxStatus
  isKnown?: boolean
  receipt?: TxReceiptInfo
}

export type TxStatusResolver<T extends Chain = Chain> = Resolver<
  {
    chain: T
    hash: string
  },
  Promise<TxStatusResult>
>
