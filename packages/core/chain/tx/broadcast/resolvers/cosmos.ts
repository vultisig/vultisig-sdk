import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({ chain, tx }) => {
  try {
    const { serialized } = tx
    const { tx_bytes } = JSON.parse(serialized)
    const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

    const client = await getCosmosClient(chain)
    const result = await attempt(client.broadcastTx(decodedTxBytes))

    if (result.data !== undefined) {
      return broadcastAccepted(result.data.transactionHash)
    }

    const { error } = result
    if (isInError(error, 'tx already exists in cache')) {
      return broadcastAccepted()
    }

    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(error))
    }
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
