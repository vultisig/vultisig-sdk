import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'
type CoinPricesResponse = Record<string, Record<FiatCurrency, number>>

type QueryCoingeickoPricesInput = {
  url: string
  fiatCurrency: FiatCurrency
  signal?: AbortSignal
}

export const queryCoingeickoPrices = async ({ url, fiatCurrency, signal }: QueryCoingeickoPricesInput) => {
  const result = await queryUrl<CoinPricesResponse>(url, signal ? { signal } : undefined)

  return recordMap(result, value => value[fiatCurrency])
}
