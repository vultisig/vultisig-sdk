import { OtherChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { getTronTxHash } from '../../hash/resolvers/tron'
import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastTronTx: BroadcastTxResolver<OtherChain.Tron> = async ({ chain, tx }) => {
  try {
    const result = await queryUrl<{ txid?: string; result?: boolean; code?: string; message?: string }>(
      `${tronRpcUrl}/wallet/broadcasttransaction`,
      {
        body: tx.json,
      }
    )

    if (result.result === false || result.code) {
      const msg = result.message
        ? Buffer.from(result.message, 'hex').toString('utf8')
        : (result.code ?? 'Unknown error')
      const error = new Error(`Tron broadcast failed: ${msg}`)
      try {
        return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
      } catch (cause) {
        return broadcastFailed(cause, false)
      }
    }

    const localHash = await getTronTxHash(tx)
    if (!result.txid || result.txid.replace(/^0x/i, '').toLowerCase() !== localHash.toLowerCase()) {
      return broadcastFailed(new Error('Tron broadcast returned a missing or mismatched transaction ID'), false)
    }

    return broadcastAccepted(localHash)
  } catch (error) {
    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(error))
    }
  }
}
