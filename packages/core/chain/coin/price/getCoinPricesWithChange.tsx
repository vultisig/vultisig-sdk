import { rootApiUrl } from '@vultisig/core-config'
import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { defaultFiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { addQueryParams } from '@vultisig/lib-utils/query/addQueryParams'

import {
  type CoinPriceWithChange,
  queryCoingeickoPricesWithChange,
} from './queryCoingeickoPricesWithChange'

const baseUrl = `${rootApiUrl}/coingeicko/api/v3/simple/price`

type GetCoinPricesWithChangeInput = {
  ids: string[]
  fiatCurrency?: FiatCurrency
}

/**
 * Like `getCoinPrices`, but also returns each coin's 24h % change.
 *
 * Separate entry point (not a flag on `getCoinPrices`) so the existing
 * function and its `Record<string, number>` contract — relied on by
 * FiatValueService, fiatToAmount, getErc20Prices — stay byte-identical.
 * Consumers that need the change (e.g. the dashboard price widget's
 * −3.97% indicator) opt into this; everyone else is unaffected.
 */
export const getCoinPricesWithChange = async ({
  ids,
  fiatCurrency = defaultFiatCurrency,
}: GetCoinPricesWithChangeInput): Promise<
  Record<string, CoinPriceWithChange>
> => {
  const normalizedIds = Array.from(
    new Set(ids.map(id => id.toLowerCase()).filter(Boolean))
  )

  const url = addQueryParams(baseUrl, {
    ids: normalizedIds.join(','),
    vs_currencies: fiatCurrency,
    include_24hr_change: 'true',
  })

  return queryCoingeickoPricesWithChange({
    url,
    fiatCurrency,
  })
}
