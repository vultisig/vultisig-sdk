import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

type RawPoolStatus = {
  status?: string
}

/**
 * Verify a THORChain pool is currently depositable.
 *
 * Hits the thornode `/thorchain/pool/{asset}` endpoint and asserts the
 * `status` field is `Available`. Throws on `Staged`, `Suspended`, or any
 * other non-Available state, and on network failures.
 *
 * Use this as the fail-fast gate before building an LP add payload — it is
 * cheaper than building the payload first and discovering at broadcast time
 * that the pool is paused.
 */
export const assertPoolDepositable = async (pool: string): Promise<void> => {
  const url = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/pool/${encodeURIComponent(pool)}`
  const raw = await queryUrl<RawPoolStatus>(url)
  if (raw.status !== 'Available') {
    throw new Error(
      `assertPoolDepositable: pool ${pool} status is ${raw.status ?? 'unknown'}, must be Available for LP add`
    )
  }
}
