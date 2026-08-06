import { fromChainAmountExact } from '@vultisig/core-chain/amount/fromChainAmountExact'
import { CoinAmount } from '@vultisig/core-chain/coin/Coin'
import { EntityWithPrice } from '@vultisig/lib-utils/entities/EntityWithPrice'

/**
 * Convert base units to their exact human decimal before entering the
 * necessarily number-based price calculation. Converting the raw bigint to a
 * number first can round once before division and again afterward.
 */
export const getCoinValue = ({ amount, decimals, price }: CoinAmount & EntityWithPrice) => {
  const sign = amount < 0n ? -1 : 1
  const absoluteAmount = amount < 0n ? -amount : amount

  return sign * Number(fromChainAmountExact(absoluteAmount, decimals)) * price
}
