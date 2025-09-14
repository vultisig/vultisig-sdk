import { fromChainAmount } from '../../../amount/fromChainAmount'
import { Chain, EvmChain } from '../../../Chain'
import { chainFeeCoin } from '../../../coin/chainFeeCoin'
import { gwei } from '../evm/gwei'
import { getFeeAmount } from '../getFeeAmount'
import { KeysignChainSpecific } from '../../../../mpc/keysign/chainSpecific/KeysignChainSpecific'
import { isOneOf } from '../../../../../lib/utils/array/isOneOf'
import { formatTokenAmount } from '../../../../../lib/utils/formatTokenAmount'

import { getFeeUnit } from './feeUnit'

type FormatFeeInput = {
  chain: Chain
  chainSpecific: KeysignChainSpecific
}

export const formatFee = ({ chain, chainSpecific }: FormatFeeInput) => {
  const feeAmount = getFeeAmount(chainSpecific)

  const decimals = isOneOf(chain, Object.values(EvmChain))
    ? gwei.decimals
    : chainFeeCoin[chain].decimals

  const amount = fromChainAmount(feeAmount, decimals)

  return formatTokenAmount(amount, getFeeUnit(chain))
}
