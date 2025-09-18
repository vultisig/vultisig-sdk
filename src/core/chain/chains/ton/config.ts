import { toChainAmount } from '../../amount/toChainAmount'
import { Chain } from '../../Chain'
import { chainFeeCoin } from '../../coin/chainFeeCoin'

export const tonConfig = {
  fee: toChainAmount(0.01, chainFeeCoin[Chain.Ton].decimals),
}
