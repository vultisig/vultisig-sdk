import { fromBase64 } from '@mysten/sui/utils'
import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import {
  describeSuiExecutionFailure,
  isSuiExecutionSuccess,
  SuiTransactionResultLike,
} from '@vultisig/core-chain/chains/sui/transactionResult'
import { attempt } from '@vultisig/lib-utils/attempt'

import { BroadcastTxResolver } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const assertSuiTxSucceeded = (result: SuiTransactionResultLike | null | undefined): void => {
  if (isSuiExecutionSuccess(result)) return

  throw new DeliverTxFailedError(`Sui transaction failed on-chain: ${describeSuiExecutionFailure(result)}`)
}

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({ chain, tx }) => {
  const { data: response, error } = await attempt(
    getSuiClient().executeTransaction({
      transaction: fromBase64(tx.unsignedTx),
      signatures: [tx.signature],
      // sdk#1398: without requesting effects, execution resolves with a digest even when the tx
      // executed but ABORTED (MoveAbort / InsufficientGas) — an RPC-level success that is NOT
      // execution success. Ask for effects so we can tell the two apart.
      include: { effects: true },
    })
  )

  if (error) {
    await verifyBroadcastByHash({ chain, tx, error })
    return
  }

  if (!response) {
    return
  }

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
  assertSuiTxSucceeded(response)

  return response
}
