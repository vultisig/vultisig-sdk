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

/**
 * Why a transaction ended in `error`, when the chain exposes a reason. `reason`
 * is a stable, chain-specific identifier (see `TonTxFailureReason`) a UI can
 * translate; `message` is the English explanation with the remedy for consumers
 * that only print text; `exitCode` is the raw contract/VM code when there is
 * one, and `phase` names the execution phase that produced it (TON: `compute`
 * or `action` — the same number means different things in each).
 */
export type TxFailureInfo = {
  reason: string
  message: string
  exitCode?: number
  phase?: string
}

export type TxStatusResult = {
  status: TxStatus
  isKnown?: boolean
  receipt?: TxReceiptInfo
  failure?: TxFailureInfo
}

export type TxStatusInput<T extends Chain = Chain> = {
  chain: T
  hash: string
  lastValidBlockHeight?: number
}

export type TxStatusResolver<T extends Chain = Chain> = Resolver<TxStatusInput<T>, Promise<TxStatusResult>>
