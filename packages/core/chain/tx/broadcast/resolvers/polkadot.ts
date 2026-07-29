import { OtherChain } from '@vultisig/core-chain/Chain'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { polkadotRpcUrl } from '../../../chains/polkadot/client'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'
import { formatSubstrateRpcError, isIdempotentSubstrateBroadcastError, SubstrateRpcError } from './substrate'

type RpcResponse = {
  result?: string
  error?: SubstrateRpcError
}

export const broadcastPolkadotTx: BroadcastTxResolver<OtherChain.Polkadot> = async ({ chain, tx }) => {
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
      // Slow device in an MPC peer race — the initiator (or any other peer)
      // already submitted this exact tx; the node tells us with a Pool error
      // (string usually in `message`) or, less commonly, an Invalid
      // Transaction variant whose duplicate signal lives in `data`.
      if (isIdempotentSubstrateBroadcastError(response.error)) {
        return
      }
      throw new Error(`Polkadot broadcast failed: ${formatSubstrateRpcError(response.error)}`)
    }

    // Per JSON-RPC 2.0 a valid response must have exactly one of `result` /
    // `error`. If both are missing (malformed gateway response, truncated
    // body, …) do not silently assume success — force hash verification.
    if (!response.result) {
      throw new Error('Polkadot broadcast failed: missing extrinsic hash in RPC response')
    }
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
