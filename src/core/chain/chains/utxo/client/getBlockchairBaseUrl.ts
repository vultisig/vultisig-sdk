import { UtxoBasedChain } from '../../../Chain'
import { rootApiUrl } from '../../../../config'

export const getBlockchairBaseUrl = (chain: UtxoBasedChain) =>
  `${rootApiUrl}/blockchair/${chain.toLowerCase()}`
