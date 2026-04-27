import { OtherChain } from '@vultisig/core-chain/Chain'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { polkadotRpcUrl } from '../../../chains/polkadot/client'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type RpcResponse = {
  result?: string
  error?: { code: number; message: string }
}

export const broadcastPolkadotTx: BroadcastTxResolver<
  OtherChain.Polkadot
> = async ({ chain, tx }) => {
  const hexWithPrefix = ensureHexPrefix(Buffer.from(tx.encoded).toString('hex'))

  try {
    const response = await queryUrl<RpcResponse>(polkadotRpcUrl, {
      body: {
        jsonrpc: '2.0',
        method: 'author_submitExtrinsic',
        params: [hexWithPrefix],
        id: 1,
      },
    })

    if (response.error) {
      throw new Error(
        `Polkadot broadcast failed: ${response.error.message ?? `code ${response.error.code}`}`
      )
    }

    // Per JSON-RPC 2.0 a valid response must have exactly one of `result` /
    // `error`. If both are missing (malformed gateway response, truncated
    // body, …) do not silently assume success — force hash verification.
    if (!response.result) {
      throw new Error(
        'Polkadot broadcast failed: missing extrinsic hash in RPC response'
      )
    }
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
