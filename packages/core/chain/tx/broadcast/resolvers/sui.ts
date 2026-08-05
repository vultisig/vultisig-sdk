import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({ chain, tx }) => {
  try {
    const response = await getSuiClient().executeTransactionBlock({
      transactionBlock: tx.unsignedTx,
      signature: [tx.signature],
    })
    return broadcastAccepted(response.digest)
  } catch (error) {
    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(error))
    }
  }
}
