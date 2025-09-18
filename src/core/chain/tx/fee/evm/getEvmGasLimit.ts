import { EvmChain } from '../../../Chain'

import { CoinKey } from '../../../coin/Coin'
import { evmNativeTokenGasLimit, evmTokenGasLimit } from './evmGasLimit'

export const getEvmGasLimit = ({ chain, id }: CoinKey<EvmChain>) => {
  const record = id ? evmTokenGasLimit : evmNativeTokenGasLimit
  return record[chain]
}
