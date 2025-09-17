import { UtxoChain } from '../../../Chain'
import { chainFeeCoin } from '../../../coin/chainFeeCoin'

export const getUtxoFeeUnit = (chain: UtxoChain): string =>
  `${chainFeeCoin[chain].ticker}/vbyte`
