import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { Chain } from '../../../Chain'
import { cosmosRpcUrl } from '../cosmosRpcUrl'

export type ThorchainTxResult = {
  /** `0` means the message was accepted; anything else is a rejection. */
  code: number
  /** The node's own account of a rejection, empty on success. */
  rawLog: string
}

/**
 * A broadcast transaction's RESULT — its `code` and `raw_log` — from
 * `/cosmos/tx/v1beta1/txs/{hash}`.
 *
 * Distinct from the Midgard-backed status path, and deliberately so: Midgard
 * indexes swap ACTIONS, and a `MsgDeposit` whose handler rejects the message
 * produces no action at all — Midgard reports "not found" forever. This
 * endpoint is the only place such a rejection is visible, so it is what stops
 * a rejected limit order from sitting "pending" indefinitely.
 *
 * Returns `null` when the result is unavailable (not yet indexed, node error,
 * malformed body): "no information", never a verdict. A rejection is only ever
 * claimed from a parsed `code !== 0`.
 */
export const getThorchainTxResult = (txHash: string): Promise<ThorchainTxResult | null> =>
  withFallback(
    attempt(async (): Promise<ThorchainTxResult | null> => {
      const body = await queryUrl<{ tx_response?: { code?: unknown; raw_log?: unknown } }>(
        `${cosmosRpcUrl[Chain.THORChain]}/cosmos/tx/v1beta1/txs/${encodeURIComponent(txHash)}`
      )
      const response = body.tx_response
      if (!response || typeof response.code !== 'number') {
        return null
      }
      return {
        code: response.code,
        rawLog: typeof response.raw_log === 'string' ? response.raw_log : '',
      }
    }),
    null
  )
