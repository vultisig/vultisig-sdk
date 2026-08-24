import { fromBase64 } from '@mysten/sui/utils'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import {
  describeSuiExecutionFailure,
  getSuiResultTransaction,
  isSuiExecutionSuccess,
  SuiTransactionResultLike,
} from '@vultisig/core-chain/chains/sui/transactionResult'
import { attempt } from '@vultisig/lib-utils/attempt'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const assertSuiTxSucceeded = (result: SuiTransactionResultLike | null | undefined): void => {
  if (isSuiExecutionSuccess(result)) return

  throw new DeliverTxFailedError(`Sui transaction failed on-chain: ${describeSuiExecutionFailure(result)}`)
}

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({ chain, tx }) => {
  const result = await attempt(
    Promise.resolve().then(() =>
      getSuiClient().executeTransaction({
        transaction: fromBase64(tx.unsignedTx),
        signatures: [tx.signature],
        include: { effects: true },
      })
    )
  )

  if ('error' in result) {
    const { error } = result
    try {
      return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(error))
    }
  }

  const response = result.data

  // Mirror the status resolver (status/resolvers/sui.ts): ONLY an explicit `$kind: 'Transaction'`
  // with `status.success === true` is execution success. A `FailedTransaction` (MoveAbort /
  // InsufficientGas) — or a missing/unknown status — must NOT be returned as a digest-carrying
  // successful broadcast (that's the sdk#1398 bug). Thrown outside the RPC-error path above so it
  // isn't fed back into verifyBroadcastByHash — the tx is on-chain and failed, not un-broadcast.
  //
  // Throw DeliverTxFailedError (not a bare Error) so isTransientBroadcastError short-circuits on the
  // `instanceof` BEFORE its message-regex runs: a Sui abort error string routinely contains
  // "aborted"/"timed out", which the transient patterns match — a bare Error would be misclassified
  // as transient and the aborted tx re-sent by withTransientBroadcastRetry.
  try {
    assertSuiTxSucceeded(response)
  } catch (cause) {
    return broadcastFailed(cause, false, { provider: response })
  }

  return broadcastAccepted(getSuiResultTransaction(response)?.digest, { provider: response })
}
