import { UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'

export const getBlockchairBaseUrl = (chain: UtxoBasedChain) =>
  `${rootApiUrl}/blockchair/${chain.toLowerCase()}`
