import { EvmChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { defaultFiatCurrency, FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { toBatches } from '@vultisig/lib-utils/array/toBatches'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { attempt } from '@vultisig/lib-utils/attempt'
import { addQueryParams } from '@vultisig/lib-utils/query/addQueryParams'
import { retry } from '@vultisig/lib-utils/query/retry'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'

import { getUsdToFiatRate } from '../getUsdToFiatRate'
import { queryCoingeickoPrices } from '../queryCoingeickoPrices'
import { getEvmVaultTokenPrices } from './getEvmVaultTokenPrices'
import { getLifiTokenPrices } from './getLifiTokenPrices'

const baseUrl = `${rootApiUrl}/coingeicko/api/v3/simple/token_price/`

/** One over-long contract query used to fail every token on the chain together. */
export const contractPriceBatchSize = 25

type Input = {
  ids: string[]
  fiatCurrency?: FiatCurrency
  chain: EvmChain
}

const coinGeckoNetwork: Record<EvmChain, string> = {
  [EvmChain.Ethereum]: 'ethereum',
  [EvmChain.Avalanche]: 'avalanche',
  [EvmChain.Base]: 'base',
  [EvmChain.Blast]: 'blast',
  [EvmChain.Arbitrum]: 'arbitrum-one',
  [EvmChain.Polygon]: 'polygon-pos',
  [EvmChain.Optimism]: 'optimistic-ethereum',
  [EvmChain.BSC]: 'binance-smart-chain',
  [EvmChain.Zksync]: 'zksync',
  [EvmChain.CronosChain]: 'cronos',
  [EvmChain.Mantle]: 'mantle',
  [EvmChain.Hyperliquid]: 'hyperliquid',
  [EvmChain.Sei]: 'sei-network',
  [EvmChain.Robinhood]: 'robinhood',
}

const lowercasePrices = (prices: Record<string, number>) =>
  Object.fromEntries(Object.entries(prices).map(([key, value]) => [key.toLowerCase(), value]))

const fetchContractPriceBatch = async (
  batch: string[],
  chain: EvmChain,
  fiatCurrency: FiatCurrency,
) => {
  const url = addQueryParams(`${baseUrl}/${coinGeckoNetwork[chain]}`, {
    contract_addresses: batch.join(','),
    vs_currencies: fiatCurrency,
  })
  // Keys are lowercased so a checksummed contract still matches.
  return lowercasePrices(await queryCoingeickoPrices({ url, fiatCurrency }))
}

/** A dropped batch is tried once more. If every batch fails, throw so the caller keeps its last prices. */
const fetchCoinGeckoContractPrices = async (
  ids: string[],
  chain: EvmChain,
  fiatCurrency: FiatCurrency,
) => {
  const batches = toBatches(ids, contractPriceBatchSize)
  const merged: Record<string, number> = {}
  const failures: unknown[] = []

  for (const batch of batches) {
    try {
      Object.assign(
        merged,
        await retry({
          func: () => fetchContractPriceBatch(batch, chain, fiatCurrency),
          attempts: 1,
        }),
      )
    } catch (error) {
      failures.push(error)
    }
  }

  if (batches.length > 0 && failures.length === batches.length) {
    throw failures[0]
  }

  return merged
}

export const getErc20Prices = async ({ ids, fiatCurrency = defaultFiatCurrency, chain }: Input) => {
  const result = await fetchCoinGeckoContractPrices(ids, chain, fiatCurrency)

  // NAV beats a market quote. A failed NAV read stays absent and falls through to LiFi.
  Object.assign(result, await getEvmVaultTokenPrices({ ids, chain, fiatCurrency }))

  const missingIds = ids.filter(id => !(id.toLowerCase() in result))
  if (isEmpty(missingIds)) return result

  // LiFi covers contracts CoinGecko omits. A LiFi failure leaves the CoinGecko prices.
  const fallbackResult = await attempt(async () => {
    const [lifiPrices, usdToFiatRate] = await Promise.all([
      getLifiTokenPrices({ ids: missingIds, chain }),
      getUsdToFiatRate(fiatCurrency),
    ])

    return recordMap(lifiPrices, usdPrice => usdPrice * usdToFiatRate)
  })

  return 'data' in fallbackResult ? { ...result, ...fallbackResult.data } : result
}
