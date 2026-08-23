import { Resolver } from '@vultisig/lib-utils/types/Resolver'

import { Chain, EvmChain } from '../../Chain'
import { SigningOutput } from '../../tw/signingOutput'
import { isTransientBroadcastError } from './transientRetry'

export const BroadcastErrorCode = {
  Rejected: 'BROADCAST_REJECTED',
  Transport: 'BROADCAST_TRANSPORT_ERROR',
} as const

export type BroadcastErrorCode = (typeof BroadcastErrorCode)[keyof typeof BroadcastErrorCode]

export type BroadcastProviderDetails = {
  /** Chain/provider-native data, isolated so it cannot become the common contract by accident. */
  provider: unknown
}

/**
 * The provider accepted (or already knew) the signed transaction.
 *
 * `finality: 'pending'` is intentional: a broadcast acknowledgement does not
 * prove that the transaction executed successfully or reached finality.
 */
export type BroadcastAcceptedResult = {
  status: 'accepted'
  finality: 'pending'
  txHash?: string
  details?: BroadcastProviderDetails
}

export type BroadcastFailedResult = {
  status: 'failed'
  code: BroadcastErrorCode
  retryable: boolean
  /** Original provider/transport cause retained for diagnostics and logging. */
  cause: unknown
  details?: BroadcastProviderDetails
}

export type BroadcastTxResult = BroadcastAcceptedResult | BroadcastFailedResult

export const broadcastAccepted = (txHash?: string, details?: BroadcastProviderDetails): BroadcastAcceptedResult => ({
  status: 'accepted',
  finality: 'pending',
  ...(txHash ? { txHash } : {}),
  ...(details ? { details } : {}),
})

export const broadcastFailed = (
  cause: unknown,
  retryable: boolean,
  details?: BroadcastProviderDetails
): BroadcastFailedResult => ({
  status: 'failed',
  code: retryable ? BroadcastErrorCode.Transport : BroadcastErrorCode.Rejected,
  retryable,
  cause,
  ...(details ? { details } : {}),
})

export const isRetryableBroadcastCause = (cause: unknown): boolean => isTransientBroadcastError(cause)

const hasOnlyKeys = (value: object, allowedKeys: readonly string[]): boolean =>
  Object.keys(value).every(key => allowedKeys.includes(key))

const hasValidDetails = (result: { details?: unknown }): boolean =>
  result.details === undefined ||
  (typeof result.details === 'object' &&
    result.details !== null &&
    'provider' in result.details &&
    hasOnlyKeys(result.details, ['provider']))

export const isBroadcastTxResult = (value: unknown): value is BroadcastTxResult => {
  if (!value || typeof value !== 'object') return false

  const result = value as Partial<BroadcastTxResult>
  if (result.status === 'accepted') {
    return (
      result.finality === 'pending' &&
      (result.txHash === undefined || (typeof result.txHash === 'string' && result.txHash.length > 0)) &&
      hasValidDetails(result) &&
      hasOnlyKeys(result, ['status', 'finality', 'txHash', 'details'])
    )
  }

  return (
    result.status === 'failed' &&
    ((result.code === BroadcastErrorCode.Rejected && result.retryable === false) ||
      (result.code === BroadcastErrorCode.Transport && result.retryable === true)) &&
    'cause' in result &&
    hasValidDetails(result) &&
    hasOnlyKeys(result, ['status', 'code', 'retryable', 'cause', 'details'])
  )
}

/**
 * `default` — single RPC via the chain client (current behaviour).
 * `raced-public-rpc` — Ethereum-only opt-in: race public endpoints so a
 * Blink-Protect / private-mempool proxy cannot silently drop the tx.
 */
export type BroadcastStrategy = 'default' | 'raced-public-rpc'

export type BroadcastStrategyInput<T extends Chain = Chain> =
  | {
      chain: T
      strategy?: 'default'
    }
  | (T extends typeof EvmChain.Ethereum
      ? {
          chain: T
          strategy: 'raced-public-rpc'
        }
      : never)

export type BroadcastTxInput<T extends Chain = Chain> = BroadcastStrategyInput<T> & {
  tx: SigningOutput<T>
}

export type BroadcastTxResolver<T extends Chain = Chain> = Resolver<BroadcastTxInput<T>, Promise<BroadcastTxResult>>
