import { assertIsDeliverTxSuccess, TimeoutError } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { toCosmosSequenceMismatchError } from '../cosmosSequenceMismatch'
import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export { CosmosSequenceMismatchError, toCosmosSequenceMismatchError } from '../cosmosSequenceMismatch'

export const getCosmosBroadcastTimeoutTxId = (error: unknown): string | undefined => {
  if (!(error instanceof TimeoutError)) return undefined

  const { txId } = error

  return txId.trim() || undefined
}

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({ chain, tx }) => {
  try {
    const { serialized } = tx
    const { tx_bytes } = JSON.parse(serialized)
    const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

    const client = await getCosmosClient(chain)
    const result = await attempt(client.broadcastTx(decodedTxBytes))

    if (result.data !== undefined) {
      try {
        assertIsDeliverTxSuccess(result.data)
      } catch (deliverTxError) {
        const message = deliverTxError instanceof Error ? deliverTxError.message : String(deliverTxError)
        return broadcastFailed(new DeliverTxFailedError(message, { cause: deliverTxError }), false, {
          provider: result.data,
        })
      }
      return broadcastAccepted(result.data.transactionHash, { provider: result.data })
    }

    const { error } = result
    if (isInError(error, 'tx already exists in cache')) {
      return broadcastAccepted()
    }

    const timeoutTxId = getCosmosBroadcastTimeoutTxId(error)
    if (timeoutTxId) {
      return broadcastAccepted(timeoutTxId)
    }

    const verificationError = toCosmosSequenceMismatchError(error) ?? error
    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error: verificationError }))
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(cause))
    }
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
