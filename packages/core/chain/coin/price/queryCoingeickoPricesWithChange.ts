import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'
import { recordMap } from '@vultisig/lib-utils/record/recordMap'

/**
 * One coin's spot price plus its 24h % change.
 *
 * `change24h` is optional: CoinGecko only returns it when
 * `include_24hr_change=true` was requested AND the provider has the
 * datum for that id (some long-tail ids omit it).
 */
export type CoinPriceWithChange = {
  price: number
  change24h?: number
}

/**
 * Raw CoinGecko `simple/price` shape when `include_24hr_change=true`:
 *   { ethereum: { usd: 2067.1, usd_24h_change: -3.97 }, ... }
 * The change key is `<currency>_24h_change`.
 */
type CoinPricesWithChangeResponse = Record<string, Record<string, number | undefined>>

type Input = {
  url: string
  fiatCurrency: FiatCurrency
}

/**
 * Parallel to `queryCoingeickoPrices` but preserves the 24h change the
 * plain query discards. Kept as a SEPARATE function (not a flag on the
 * existing one) so `queryCoingeickoPrices` / `getCoinPrices` /
 * `CoinPricesResult` / `FiatValueService` are 100% unaffected — no
 * regression surface on the 5+ existing call sites.
 */
export const queryCoingeickoPricesWithChange = async ({
  url,
  fiatCurrency,
}: Input): Promise<Record<string, CoinPriceWithChange>> => {
  const result = await queryUrl<CoinPricesWithChangeResponse>(url)
  const changeKey = `${fiatCurrency}_24h_change`

  return recordMap(result, value => {
    const price = value[fiatCurrency]
    const change24h = value[changeKey]
    return {
      price: typeof price === 'number' ? price : 0,
      ...(typeof change24h === 'number' ? { change24h } : {}),
    }
  })
}
