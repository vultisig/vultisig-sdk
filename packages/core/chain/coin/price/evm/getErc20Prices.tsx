import { EvmChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { defaultFiatCurrency, FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { toBatches } from '@vultisig/lib-utils/array/toBatches'
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

/** One deadline for every batch. A stalled proxy must not stack one timeout per batch. */
export const contractPricesDeadlineMs = 20_000

const contractPriceRetryDelayMs = 1_000

type ContractPriceLookup = {
  prices: Record<string, number>
  failedIds: string[]
}

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
  signal: AbortSignal
) => {
  const url = addQueryParams(`${baseUrl}/${coinGeckoNetwork[chain]}`, {
    contract_addresses: batch.join(','),
    vs_currencies: fiatCurrency,
  })
  // Keys are lowercased so a checksummed contract still matches.
  return lowercasePrices(await queryCoingeickoPrices({ url, fiatCurrency, signal }))
}

const failedBatchIds = (batch: string[]) => batch.map(id => id.toLowerCase())

/** A dropped batch is tried once more, inside one shared deadline. If nothing comes back, throw. */
const fetchCoinGeckoContractPrices = async (
  ids: string[],
  chain: EvmChain,
  fiatCurrency: FiatCurrency
): Promise<ContractPriceLookup> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), contractPricesDeadlineMs)
  try {
    return await fetchContractPriceBatches(ids, chain, fiatCurrency, controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

const fetchContractPriceBatches = async (
  ids: string[],
  chain: EvmChain,
  fiatCurrency: FiatCurrency,
  signal: AbortSignal
): Promise<ContractPriceLookup> => {
  const batches = toBatches(ids, contractPriceBatchSize)
  const prices: Record<string, number> = {}
  const failedIds: string[] = []
  const failures: unknown[] = []
  let succeeded = 0

  for (const batch of batches) {
    if (signal.aborted) {
      failedIds.push(...failedBatchIds(batch))
      continue
    }
    try {
      Object.assign(prices, await fetchBatchWithOneRetry(batch, chain, fiatCurrency, signal))
      succeeded += 1
    } catch (error) {
      failures.push(error)
      failedIds.push(...failedBatchIds(batch))
    }
  }

  if (batches.length > 0 && succeeded === 0) {
    throw failures[0] ?? new Error('contract price deadline')
  }

  return { prices, failedIds }
}

const fetchBatchWithOneRetry = (batch: string[], chain: EvmChain, fiatCurrency: FiatCurrency, signal: AbortSignal) =>
  retry({
    func: () => fetchContractPriceBatch(batch, chain, fiatCurrency, signal),
    attempts: 1,
    delay: contractPriceRetryDelayMs,
    shouldRetry: () => !signal.aborted,
  })

const withoutPriced = (ids: string[], prices: Record<string, number>) => ids.filter(id => !(id.toLowerCase() in prices))

/** Prices plus the contract ids whose lookup failed. An unlisted token is absent from both. */
export const getErc20PricesSettled = async ({
  ids,
  fiatCurrency = defaultFiatCurrency,
  chain,
}: Input): Promise<ContractPriceLookup> => {
  const coinGecko = await fetchCoinGeckoContractPrices(ids, chain, fiatCurrency)
  const prices = { ...coinGecko.prices }

  // NAV beats a market quote. A failed NAV read stays absent and falls through to LiFi.
  Object.assign(prices, await getEvmVaultTokenPrices({ ids, chain, fiatCurrency }))

  const failed = new Set(withoutPriced(coinGecko.failedIds, prices))
  const missingIds = ids.filter(id => !(id.toLowerCase() in prices) && !failed.has(id.toLowerCase()))
  if (isEmpty(missingIds)) return { prices, failedIds: [...failed] }

  const fallback = await lifiFallback(missingIds, chain, fiatCurrency)
  if ('error' in fallback) {
    for (const id of missingIds) failed.add(id.toLowerCase())
    return { prices, failedIds: [...failed] }
  }

  Object.assign(prices, fallback.data.prices)
  for (const id of fallback.data.failedIds) {
    if (!(id.toLowerCase() in prices)) failed.add(id.toLowerCase())
  }
  return { prices, failedIds: [...withoutPriced([...failed], prices)] }
}

const lifiFallback = (missingIds: string[], chain: EvmChain, fiatCurrency: FiatCurrency) =>
  attempt(async () => {
    const [lifi, usdToFiatRate] = await Promise.all([
      getLifiTokenPrices({ ids: missingIds, chain }),
      getUsdToFiatRate(fiatCurrency),
    ])
    return {
      prices: recordMap(lifi.prices, usdPrice => usdPrice * usdToFiatRate),
      failedIds: lifi.failedIds,
    }
  })

export const getErc20Prices = async (input: Input) => (await getErc20PricesSettled(input)).prices
