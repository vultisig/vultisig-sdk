import { getBlockchainSpecificValue } from '@vultisig/core-mpc/keysign/chainSpecific/KeysignChainSpecific'

import { FeeAmountResolver } from '../resolver'

export const getQbtcFeeAmount: FeeAmountResolver = ({ keysignPayload }) => {
  const cosmosSpecific = getBlockchainSpecificValue(
    keysignPayload.blockchainSpecific,
    'cosmosSpecific'
  )
  return cosmosSpecific.gas
}
