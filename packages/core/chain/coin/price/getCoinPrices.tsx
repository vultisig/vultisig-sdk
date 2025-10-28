import { rootApiUrl } from '../../../config'
import { FiatCurrency } from '../../../config/FiatCurrency'
import { defaultFiatCurrency } from '../../../config/FiatCurrency'
import { addQueryParams } from '../../../../lib/utils/query/addQueryParams'

import { queryCoingeickoPrices } from './queryCoingeickoPrices'
const baseUrl = `${rootApiUrl}/coingeicko/api/v3/simple/price`

type GetCoinPricesInput = {
  ids: string[]
  fiatCurrency?: FiatCurrency
}

export const getCoinPrices = async ({
  ids,
  fiatCurrency = defaultFiatCurrency,
}: GetCoinPricesInput) => {
  const url = addQueryParams(baseUrl, {
    ids: ids.join(','),
    vs_currencies: fiatCurrency,
  })

  return queryCoingeickoPrices({
    url,
    fiatCurrency,
  })
}
