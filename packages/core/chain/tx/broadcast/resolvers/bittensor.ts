import { OtherChain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'
import { formatSubstrateRpcError, isIdempotentSubstrateBroadcastError, SubstrateRpcError } from './substrate'

type RpcResponse = {
  result?: string
  error?: SubstrateRpcError
}

export const broadcastBittensorTx: BroadcastTxResolver<OtherChain.Bittensor> = async ({ chain, tx }) => {
  const hexWithPrefix = ensureHexPrefix(Buffer.from(tx.encoded).toString('hex'))

  try {
    const response = await queryUrl<RpcResponse>(bittensorRpcUrl, {
      body: {
        jsonrpc: '2.0',
        method: 'author_submitExtrinsic',
        params: [hexWithPrefix],
        id: 1,
      },
    })

    if (response.error) {
      if (isIdempotentSubstrateBroadcastError(response.error)) {
        return
      }
      throw new Error(`Bittensor broadcast failed: ${formatSubstrateRpcError(response.error)}`)
    }

    if (!response.result) {
      throw new Error('Bittensor broadcast failed: missing extrinsic hash in RPC response')
    }
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
