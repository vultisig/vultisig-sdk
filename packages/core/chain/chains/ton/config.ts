import { toChainAmount } from '../../amount/toChainAmount'
import { Chain } from '../../Chain'
import { chainFeeCoin } from '../../coin/chainFeeCoin'

export const tonConfig = {
  baseFee: toChainAmount(0.01, chainFeeCoin[Chain.Ton].decimals),
  jettonAmount: toChainAmount(0.08, chainFeeCoin[Chain.Ton].decimals),
}
