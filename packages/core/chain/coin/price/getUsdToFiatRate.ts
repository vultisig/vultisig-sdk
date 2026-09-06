import { FiatCurrency } from '@vultisig/core-config/FiatCurrency'

import { getCoinPrices } from './getCoinPrices'

// USD stablecoin anchor: its CoinGecko price in a given fiat currency serves
// as the USD -> fiat conversion rate.
const usdAnchorPriceProviderId = 'usd-coin'

/**
 * Resolves the USD -> fiat conversion rate for USD-denominated price sources
 * (e.g. LI.FI). Throws when the anchor quote is unavailable rather than
 * letting callers mislabel raw USD values as the selected fiat.
 */
export const getUsdToFiatRate = async (fiatCurrency: FiatCurrency): Promise<number> => {
  if (fiatCurrency === 'usd') return 1

  const anchorPrices = await getCoinPrices({ ids: [usdAnchorPriceProviderId], fiatCurrency })
  const rate = anchorPrices[usdAnchorPriceProviderId]
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Missing ${usdAnchorPriceProviderId} anchor price for ${fiatCurrency}`)
  }

  return rate
}
