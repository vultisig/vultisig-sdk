import { NEAR_UNSIGNED_DECIMAL } from '@vultisig/core-chain/chains/near/api'

import { getBlockchainSpecificValue } from '../../chainSpecific/KeysignChainSpecific'
import { FeeAmountResolver } from '../resolver'

/**
 * The gas reservation frozen at preparation, not a re-estimate: the signed bytes
 * never carry a fee, and re-reading the network here would let the shown fee drift
 * from the balance the user reviewed. `refineKeysignAmount` holds the send to it.
 */
export const getNearFeeAmount: FeeAmountResolver = async ({ keysignPayload }) => {
  const { gasFee } = getBlockchainSpecificValue(keysignPayload.blockchainSpecific, 'nearSpecific')

  if (!NEAR_UNSIGNED_DECIMAL.test(gasFee)) {
    throw new Error(`Invalid NEAR gas fee: ${gasFee} is not an unsigned decimal integer`)
  }

  return BigInt(gasFee)
}
