import { OtherChain } from '@vultisig/core-chain/Chain'
import { callNearRpc, getNearRpcErrorName } from '@vultisig/core-chain/chains/near/rpc'
import { getNearSignerId, getNearTransactionHash } from '@vultisig/core-chain/chains/near/signedTransaction'
import { NearTxOutcome, readNearOutcomeHash } from '@vultisig/core-chain/chains/near/txOutcome'
import { Buffer } from 'buffer'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

/** Malformed requests: a copy of an already valid transaction can never produce them. */
const nearMalformedRequestNames = new Set(['REQUEST_VALIDATION_ERROR', 'PARSE_ERROR'])

/**
 * Final for these bytes, but also nearcore's answer to a peer re-sending a
 * transaction that already landed (`InvalidNonce` when its own lookup misses
 * it), so the hash decides before the rejection is reported.
 */
const NEAR_INVALID_TRANSACTION = 'INVALID_TRANSACTION'

/**
 * Broadcasts the frozen signed bytes and binds the node's answer to the hash
 * derived locally from those same bytes, so an acknowledgement for a different
 * transaction can never be reported as this one. `wait_until: INCLUDED` stops at
 * inclusion; any error but a malformed request leaves the state unknown, so the
 * hash is verified against the chain before either failing or accepting.
 */
export const broadcastNearTx: BroadcastTxResolver<OtherChain.Near> = async ({ chain, tx }) => {
  const localHash = getNearTransactionHash(tx.signedTransaction)
  const senderAccountId = getNearSignerId(tx.signedTransaction)

  try {
    const result = await callNearRpc<NearTxOutcome>('send_tx', {
      signed_tx_base64: Buffer.from(tx.signedTransaction).toString('base64'),
      wait_until: 'INCLUDED',
    })

    const returnedHash = readNearOutcomeHash(result)

    if (returnedHash !== undefined && returnedHash !== localHash) {
      return broadcastFailed(
        new Error(`NEAR broadcast returned ${returnedHash} for a transaction whose local hash is ${localHash}`),
        false,
        { provider: result }
      )
    }

    return broadcastAccepted(localHash, { provider: result })
  } catch (error) {
    const errorName = getNearRpcErrorName(error)
    if (errorName !== undefined && nearMalformedRequestNames.has(errorName)) {
      return broadcastFailed(error, false)
    }

    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error, senderAccountId }))
    } catch (cause) {
      return broadcastFailed(cause, errorName !== NEAR_INVALID_TRANSACTION && isRetryableBroadcastCause(error))
    }
  }
}
