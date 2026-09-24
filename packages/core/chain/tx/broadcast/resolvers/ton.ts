import { OtherChain } from '@vultisig/core-chain/Chain'
import { parseTonBroadcastRejection, TonBroadcastRejectedError } from '@vultisig/core-chain/chains/ton/failure'
import { sendTonGasless } from '@vultisig/core-chain/chains/ton/gasless/api'
import { isTonGaslessRequest } from '@vultisig/core-chain/chains/ton/gasless/request'
import { SigningOutput } from '@vultisig/core-chain/tw/signingOutput'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import {
  broadcastAccepted,
  broadcastFailed,
  BroadcastTxResolver,
  BroadcastTxResult,
  isRetryableBroadcastCause,
} from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type BroadcastTonGaslessInput = {
  chain: OtherChain.Ton
  tx: SigningOutput<OtherChain.Ton>
}

/**
 * Hands a relayed (gasless) request to the relay instead of the network. The
 * relay wraps the signed body in an internal message it pays for and reports
 * the normalized hash of the external message it broadcast, which is the id of
 * the whole trace — what explorers and the status lookup resolve. Should the
 * relay not report one, the signed body's hash (the one the compile step
 * recorded) still identifies the wallet's own transaction.
 */
const broadcastTonGaslessTx = async ({ chain, tx }: BroadcastTonGaslessInput): Promise<BroadcastTxResult> => {
  const bodyHash = Buffer.from(tx.hash).toString('hex')

  const result = await attempt(sendTonGasless({ boc: tx.encoded }))
  if ('data' in result) {
    return broadcastAccepted(result.data?.external || bodyHash)
  }

  // A co-signer may already have handed the same request to the relay; the
  // body hash finds the wallet's transaction whoever relayed it first.
  try {
    return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error: result.error }))
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(result.error))
  }
}

export const broadcastTonTx: BroadcastTxResolver<OtherChain.Ton> = async ({ chain, tx }) => {
  if (isTonGaslessRequest(tx.encoded)) {
    return broadcastTonGaslessTx({ chain, tx })
  }

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
    // The wallet contract refusing the message (seqno replay, expired
    // valid_until, bad signature …) is final: re-sending the same bytes gets
    // the same refusal, and the user needs the reason, not a retry.
    const failure = parseTonBroadcastRejection(cause)
    if (failure) {
      return broadcastFailed(new TonBroadcastRejectedError(failure, cause), false)
    }

    return broadcastFailed(cause, responseMissingHash ? false : isRetryableBroadcastCause(error))
  }
}
