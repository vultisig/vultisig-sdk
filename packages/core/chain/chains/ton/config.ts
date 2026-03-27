import { toChainAmount } from '@vultisig/core-chain/amount/toChainAmount'
import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

export const tonConfig = {
  baseFee: toChainAmount(0.01, chainFeeCoin[Chain.Ton].decimals),
  jettonAmount: toChainAmount(0.08, chainFeeCoin[Chain.Ton].decimals),
}
