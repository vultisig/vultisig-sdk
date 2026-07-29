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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Parse a `/cosmos/tx/v1beta1/txs/{hash}` body into a result, or `null` for
 * anything that isn't one.
 *
 * The code must be a non-negative safe integer — cosmos ABCI codes are uint32.
 * `typeof === 'number'` alone would let a malformed body's `-1`, `0.5` or `NaN`
 * through, and since callers read any nonzero code as a rejection, garbage
 * would surface as a verdict instead of as "no information".
 */
export const parseThorchainTxResult = (body: unknown): ThorchainTxResult | null => {
  if (!isRecord(body) || !isRecord(body.tx_response)) {
    return null
  }
  const { code, raw_log } = body.tx_response
  if (typeof code !== 'number' || !Number.isSafeInteger(code) || code < 0) {
    return null
  }
  return {
    code,
    rawLog: typeof raw_log === 'string' ? raw_log : '',
  }
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
    attempt(async () =>
      parseThorchainTxResult(
        await queryUrl<unknown>(`${cosmosRpcUrl[Chain.THORChain]}/cosmos/tx/v1beta1/txs/${encodeURIComponent(txHash)}`)
      )
    ),
    null
  )
