import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'
type CoinPricesResponse = Record<string, Record<FiatCurrency, number>>

type QueryCoingeickoPricesInput = {
  url: string
  fiatCurrency: FiatCurrency
}

export const queryCoingeickoPrices = async ({
  url,
  fiatCurrency,
}: QueryCoingeickoPricesInput) => {
  const result = await queryUrl<CoinPricesResponse>(url)

  return recordMap(result, value => value[fiatCurrency])
}
