import { fromChainAmount } from '@vultisig/core-chain/amount/fromChainAmount'
import { CoinAmount } from '@vultisig/core-chain/coin/Coin'
import { EntityWithPrice } from '@vultisig/lib-utils/entities/EntityWithPrice'

export const getCoinValue = ({
  amount,
  decimals,
  price,
}: CoinAmount & EntityWithPrice) => fromChainAmount(amount, decimals) * price
