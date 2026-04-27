import { OtherChain } from '@vultisig/core-chain/Chain'
import { bittensorRpcUrl } from '@vultisig/core-chain/chains/bittensor/client'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type RpcResponse = {
  result?: string
  error?: { code: number; message: string }
}

export const broadcastBittensorTx: BroadcastTxResolver<
  OtherChain.Bittensor
> = async ({ chain, tx }) => {
  const hexWithPrefix = ensureHexPrefix(
    Buffer.from(tx.encoded).toString('hex')
  )

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
      return
    }
    const err = new Error(
      `Bittensor broadcast failed: ${message || `code ${response.error.code}`}`
    )
    await verifyBroadcastByHash({ chain, tx, error: err })
  }
}
