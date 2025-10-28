import { fromChainAmount } from '../../amount/fromChainAmount'
import { CoinAmount } from '../Coin'
import { EntityWithPrice } from '../../../../lib/utils/entities/EntityWithPrice'

export const getCoinValue = ({
  amount,
  decimals,
  price,
}: CoinAmount & EntityWithPrice) => fromChainAmount(amount, decimals) * price
