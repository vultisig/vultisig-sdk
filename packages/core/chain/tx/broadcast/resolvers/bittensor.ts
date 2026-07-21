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

export const broadcastBittensorTx: BroadcastTxResolver<OtherChain.Bittensor> = async ({ chain, tx }) => {
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
      return
    }
    const err = new Error(`Bittensor broadcast failed: ${message || `code ${response.error.code}`}`)
    await verifyBroadcastByHash({ chain, tx, error: err })
    return
  }

  // Per JSON-RPC 2.0 a valid response carries exactly one of `result` / `error`. Neither present
  // (malformed / truncated gateway body) must NOT be assumed a success — force hash verification.
  // Mirrors the polkadot resolver's guard; without it a truncated body returned `undefined` = success.
  if (!response.result) {
    const err = new Error('Bittensor broadcast failed: missing extrinsic hash in RPC response')
    await verifyBroadcastByHash({ chain, tx, error: err })
  }
}
