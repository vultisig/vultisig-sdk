import { queryTron } from '@vultisig/core-chain/chains/tron/queryTron'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'

const CHAIN_PARAMS_URL = '/wallet/getchainparameters'

// 5 min TTL - governance proposals that change energy price are extremely
// rare (last change was 2023) so this trades one RPC call per 5 min window
// against always paying the right price post any future proposal.
const CACHE_TTL_MS = 5 * 60 * 1000

type ChainParameter = {
  key: string
  value?: number
}

type GetChainParametersResponse = {
  chainParameter?: ChainParameter[]
}

const fetchEnergyPriceRaw = async (): Promise<bigint> => {
  const data = await queryTron<GetChainParametersResponse>(CHAIN_PARAMS_URL, {
    headers: { accept: 'application/json' },
  })

  const param = data.chainParameter?.find(p => p.key === 'getEnergyFee')
  if (param?.value == null || param.value <= 0) {
    throw new Error('Tron chain parameters contain no valid energy price')
  }

  return BigInt(param.value)
}

// Only successful fetches are memoized. Errors bubble up so the catch below
// never caches the fallback as if it were a real price (fixes error-caching bug).
const memoizedFetchEnergyPrice = memoizeAsync(fetchEnergyPriceRaw, {
  cacheTime: CACHE_TTL_MS,
})

/** Current on-chain sun/energy, cached for five minutes only after a successful read. */
export const getEnergyPrice = (): Promise<bigint> => memoizedFetchEnergyPrice()
