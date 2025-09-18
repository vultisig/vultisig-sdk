import { chainFeeCoin } from '../../../coin/chainFeeCoin'
import { CoinKey } from '../../../coin/Coin'
import { isFeeCoin } from '../../../coin/utils/isFeeCoin'

import { Chain } from '../../../Chain'

// Use THORChain's decimals for all native swaps, except for the CACAO asset,
// which is the only asset that uses 10 decimals.
export const getNativeSwapDecimals = (coin: CoinKey) => {
  if (coin.chain === Chain.MayaChain && isFeeCoin(coin)) {
    return chainFeeCoin[coin.chain].decimals
  }

  return chainFeeCoin[Chain.THORChain].decimals
}
