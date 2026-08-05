import { OtherChain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type RpcResponse = {
  result?: string
  error?: { code: number; message: string }
}

export const broadcastBittensorTx: BroadcastTxResolver<OtherChain.Bittensor> = async ({ chain, tx }) => {
  try {
    const hexWithPrefix = ensureHexPrefix(Buffer.from(tx.encoded).toString('hex'))

    const response = await queryUrl<RpcResponse>(bittensorRpcUrl, {
      body: {
        jsonrpc: '2.0',
        method: 'author_submitExtrinsic',
        params: [hexWithPrefix],
        id: 1,
      },
    })

    if (response.error) {
      const message = response.error.message ?? ''
      // "Already Imported" means another device already broadcast this tx — not an error
      if (message.includes('Already Imported')) {
        return broadcastAccepted()
      }
      const error = new Error(`Bittensor broadcast failed: ${message || `code ${response.error.code}`}`)
      try {
        return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
      } catch (cause) {
        return broadcastFailed(cause, false)
      }
    }

    return response.result
      ? broadcastAccepted(response.result)
      : broadcastFailed(new Error('Bittensor broadcast failed: missing extrinsic hash in RPC response'), true)
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
