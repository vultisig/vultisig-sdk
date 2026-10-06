import { NEAR_MAX_U128, parseNearUint } from '@vultisig/core-chain/chains/near/uint'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { FeeAmountResolver } from '../resolver'

/**
 * The gas reservation frozen at preparation, not a re-estimate: the signed bytes
 * never carry a fee, and re-reading the network here would let the shown fee drift
 * from the balance the user reviewed. `refineKeysignAmount` holds the send to it.
 */
export const getNearFeeAmount: FeeAmountResolver = async ({ keysignPayload }) => {
  const { gasFee } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'nearSpecific')

  return parseNearUint(gasFee, 'gas fee', NEAR_MAX_U128)
}
