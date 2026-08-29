import { EvmChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { defaultFiatCurrency, FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { isEmpty } from '@vultisig/lib-utils/array/isEmpty'
import { attempt } from '@vultisig/lib-utils/attempt'
import { addQueryParams } from '@vultisig/lib-utils/query/addQueryParams'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'

import { getUsdToFiatRate } from '../getUsdToFiatRate'
import { queryCoingeickoPrices } from '../queryCoingeickoPrices'
import { getEvmVaultTokenPrices } from './getEvmVaultTokenPrices'
import { getLifiTokenPrices } from './getLifiTokenPrices'

const baseUrl = `${rootApiUrl}/coingeicko/api/v3/simple/token_price/`

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

export const getErc20Prices = async ({ ids, fiatCurrency = defaultFiatCurrency, chain }: Input) => {
  const url = addQueryParams(`${baseUrl}/${coinGeckoNetwork[chain]}`, {
    contract_addresses: ids.join(','),
    vs_currencies: fiatCurrency,
  })

  const prices = await queryCoingeickoPrices({
    url,
    fiatCurrency,
  })

  // Normalize contract-address keys to lowercase so consumers can do
  // `prices[addr.toLowerCase()]` without depending on upstream casing.
  const result = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k.toLowerCase(), v]))

  // NAV-priced vault receipts (e.g. vTHOR) override market feeds: illiquid
  // receipts carry stale market quotes, while the redemption value is exact.
  // A vault the NAV read fails for stays absent and falls through to the
  // LiFi fallback below.
  Object.assign(result, await getEvmVaultTokenPrices({ ids, chain, fiatCurrency }))

  const missingIds = ids.filter(id => !(id.toLowerCase() in result))
  if (isEmpty(missingIds)) return result

  // CoinGecko does not list some curated tokens at all (e.g. vTHOR, #2205),
  // which used to pin them at 0. LI.FI prices them in USD; convert through the
  // usd-coin anchor. The fallback degrades gracefully: on failure the
  // CoinGecko prices still stand and the missing tokens stay unpriced,
  // exactly as before.
  const fallbackResult = await attempt(async () => {
    const [lifiPrices, usdToFiatRate] = await Promise.all([
      getLifiTokenPrices({ ids: missingIds, chain }),
      getUsdToFiatRate(fiatCurrency),
    ])

    return recordMap(lifiPrices, usdPrice => usdPrice * usdToFiatRate)
  })

  return 'data' in fallbackResult ? { ...result, ...fallbackResult.data } : result
}
