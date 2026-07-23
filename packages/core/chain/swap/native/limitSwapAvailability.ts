import { attempt, withFallback } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { Chain } from '../../Chain'
import { cosmosRpcUrl } from '../../chains/cosmos/cosmosRpcUrl'

/** The mimir key gating THORChain's Advanced Swap Queue — what makes `=<` a real resting limit order. */
export const advancedSwapQueueMimirKey = 'EnableAdvSwapQueue'

const advancedSwapQueueMimirUrl = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/mimir/key/${advancedSwapQueueMimirKey}`

/**
 * Interpret a `/thorchain/mimir/key/<KEY>` body. THORChain returns the value as a
 * bare integer, and only an exact `1` (after trimming whitespace) means enabled.
 *
 * Deliberately not integer-parsed: on a gate that protects funds an over-broad
 * accept set is worse than a rare false block. `0`, `2`, `-1`, a quoted `"1"`,
 * `01`, `+1`, and `1.0` all read as disabled.
 */
export const parseAdvancedSwapQueueMimir = (raw: string): boolean => raw.trim() === '1'

/**
 * Whether THORChain currently accepts resting limit orders.
 *
 * Fails closed — any network, HTTP, or parse failure returns `false`. A `=<`
 * order placed while the queue is disabled can be treated as a market swap or
 * rejected on-chain, executing at a price the user never agreed to, so the only
 * value that unblocks placement is a live, confirmed `1`.
 */
export const getAdvancedSwapQueueEnabled = async (): Promise<boolean> => {
  const raw = await withFallback(
    attempt(() =>
      queryUrl<string>(advancedSwapQueueMimirUrl, {
        responseType: 'text',
        headers: { 'X-Client-ID': 'vultisig' },
      })
    ),
    ''
  )

  return parseAdvancedSwapQueueMimir(raw)
}
