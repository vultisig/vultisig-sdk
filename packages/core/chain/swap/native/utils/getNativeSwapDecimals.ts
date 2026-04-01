import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { CoinKey } from '@vultisig/core-chain/coin/Coin'
import { knownTokensIndex } from '@vultisig/core-chain/coin/knownTokens'
import { isFeeCoin } from '@vultisig/core-chain/coin/utils/isFeeCoin'

import { Chain } from '../../../Chain'

/**
 * Returns the decimal precision used by the swap API for a given coin.
 *
 * - CACAO (MayaChain fee coin) uses 10 decimals.
 * - Other MayaChain tokens (MAYA, AZTEC) use their native decimals
 *   because the MAYAChain API reports amounts in native precision.
 * - Everything else uses THORChain's 8-decimal standard.
 */
export const getNativeSwapDecimals = (coin: CoinKey) => {
  if (coin.chain === Chain.MayaChain) {
    if (isFeeCoin(coin)) {
      return chainFeeCoin[coin.chain].decimals
    }

    const known = coin.id
      ? knownTokensIndex[coin.chain][coin.id.toLowerCase()]
      : undefined

    if (known) {
      return known.decimals
    }
  }

  return chainFeeCoin[Chain.THORChain].decimals
}
