import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/getCosmosRpcUrl'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

export type CosmosBalanceEntry = { denom: string; amount: string }

type LcdAllBalancesResponse = {
  balances?: CosmosBalanceEntry[]
  pagination?: { next_key?: string | null }
}

const PAGE_LIMIT = 1000
// Safety valve against a misbehaving LCD that never returns a null next_key.
// 1000 denoms/page * 20 pages = 20k denoms, far past any real wallet.
const MAX_PAGES = 20

/**
 * Fetches EVERY bank balance denom held at a Cosmos address via the LCD REST
 * endpoint, following `pagination.next_key` to completion.
 *
 * cosmjs's `StargateClient.getAllBalances` issues a single unpaginated
 * `QueryAllBalances`, so the node applies its default page limit (100 on most
 * Cosmos SDK chains) and silently truncates. An IBC-heavy wallet (e.g. an
 * active Osmosis DeFi user holding >100 IBC tokens + LP shares) would have
 * every denom past the first 100 dropped from token discovery. This walks the
 * pages so discovery sees the full set. LCD is already the trusted data source
 * for cosmos staking reads and the balance-resolver fallback in this package.
 */
export const getAllCosmosBalances = async (chain: CosmosChain, address: string): Promise<CosmosBalanceEntry[]> => {
  const base = getCosmosRpcUrl(chain)
  const balances: CosmosBalanceEntry[] = []
  let nextKey: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ 'pagination.limit': String(PAGE_LIMIT) })
    if (nextKey) params.set('pagination.key', nextKey)

    const resp = await queryUrl<LcdAllBalancesResponse>(
      `${base}/cosmos/bank/v1beta1/balances/${address}?${params.toString()}`
    )

    balances.push(...(resp.balances ?? []))

    const key = resp.pagination?.next_key
    if (!key) return balances
    nextKey = key
  }

  return balances
}
