import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastEvmTx: BroadcastTxResolver<EvmChain> = async ({ chain, tx }) => {
  try {
    const client = getEvmClient(chain)

    const result = await attempt(
      client.sendRawTransaction({
        serializedTransaction: ensureHexPrefix(Buffer.from(tx.encoded).toString('hex')),
      })
    )

    if ('data' in result) {
      return broadcastAccepted(result.data)
    }

    const { error } = result
    if (error && isInError(error, 'already known', 'transaction already exists', 'tx already in mempool')) {
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
