import { OtherChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastTonTx: BroadcastTxResolver<OtherChain.Ton> = async ({ chain, tx }) => {
  const url = `${rootApiUrl}/ton/v2/sendBocReturnHash`

  const result = await attempt(
    queryUrl<{ result?: { hash?: string } }>(url, {
      body: { boc: tx.encoded },
    })
  )

  const hash = result.data?.result?.hash
  if (hash) {
    return broadcastAccepted(hash)
  }

  const responseMissingHash = result.data !== undefined
  const error = responseMissingHash
    ? new Error('TON broadcast failed: missing transaction hash in response')
    : result.error
  if (isInError(error, 'duplicate message', 'duplicate msg_seqno')) {
    return broadcastAccepted()
  }

  try {
    return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
  } catch (cause) {
    return broadcastFailed(cause, responseMissingHash ? false : isRetryableBroadcastCause(error))
  }
}
