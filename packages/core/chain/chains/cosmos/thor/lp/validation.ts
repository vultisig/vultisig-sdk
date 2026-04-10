import { Chain } from '@vultisig/core-chain/Chain'
import { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { assertValidPoolId } from './pools'

const extractPoolStatus = (raw: unknown): string | undefined => {
  if (raw && typeof raw === 'object' && 'status' in raw) {
    const status = (raw as { status: unknown }).status
    return typeof status === 'string' ? status : undefined
  }
  return undefined
}

/**
 * Verify a THORChain pool is currently depositable.
 *
 * Hits the thornode `/thorchain/pool/{asset}` endpoint and asserts the
 * `status` field is `Available`. Throws on `Staged`, `Suspended`, or any
 * other non-Available state, and on network failures or unexpected payloads.
 *
 * Use this as the fail-fast gate before building an LP add payload — it is
 * cheaper than building the payload first and discovering at broadcast time
 * that the pool is paused.
 */
export const assertPoolDepositable = async (pool: string): Promise<void> => {
  assertValidPoolId(pool)
  const url = `${cosmosRpcUrl[Chain.THORChain]}/thorchain/pool/${encodeURIComponent(pool)}`
  const raw = await queryUrl<unknown>(url)
  const status = extractPoolStatus(raw)
  if (status === undefined) {
    throw new Error(
      `assertPoolDepositable: pool ${pool} response from ${url} did not include a string \`status\` field`
    )
  }
  if (status !== 'Available') {
    throw new Error(
      `assertPoolDepositable: pool ${pool} status is ${status}, must be Available for LP add`
    )
  }
}
