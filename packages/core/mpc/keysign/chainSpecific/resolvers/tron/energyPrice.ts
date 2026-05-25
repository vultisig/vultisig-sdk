import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const FALLBACK_ENERGY_PRICE = 280n

const CHAIN_PARAMS_URL = 'https://api.trongrid.io/wallet/getchainparameters'

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
  const data = await queryUrl<GetChainParametersResponse>(CHAIN_PARAMS_URL, {
    headers: { accept: 'application/json' },
  })

  const param = data.chainParameter?.find(p => p.key === 'getEnergyFee')
  if (param?.value == null || param.value <= 0) {
    return FALLBACK_ENERGY_PRICE
  }

  return BigInt(param.value)
}

// Only successful fetches are memoized. Errors bubble up so the catch below
// never caches the fallback as if it were a real price (fixes error-caching bug).
const memoizedFetchEnergyPrice = memoizeAsync(fetchEnergyPriceRaw, { cacheTime: CACHE_TTL_MS })

/**
 * Returns the current energy price in sun/energy from Tron chain params.
 * Successful fetches cached for 5 min. Falls back to 280 sun/energy (2023
 * governance default) if the endpoint is unreachable - recovery is immediate
 * once TronGrid comes back (errors are never cached).
 */
export const getEnergyPrice = async (): Promise<bigint> => {
  try {
    return await memoizedFetchEnergyPrice()
  } catch {
    return FALLBACK_ENERGY_PRICE
  }
}
