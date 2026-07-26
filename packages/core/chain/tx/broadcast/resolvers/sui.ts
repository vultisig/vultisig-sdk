import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { attempt } from '@vultisig/lib-utils/attempt'

import { BroadcastTxResolver } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type SuiExecutionEffects = {
  status?: {
    status?: string
    error?: string | null
  }
}

export const assertSuiTxSucceeded = (effects: SuiExecutionEffects | null | undefined): void => {
  const executionStatus = effects?.status?.status

  if (executionStatus === 'success') return

  throw new DeliverTxFailedError(
    `Sui transaction failed on-chain: ${effects?.status?.error ?? executionStatus ?? 'no effects status returned'}`
  )
}

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({ chain, tx }) => {
  const { data: response, error } = await attempt(
    getSuiClient().executeTransactionBlock({
      transactionBlock: tx.unsignedTx,
      signature: [tx.signature],
      // sdk#1398: without requesting effects, executeTransactionBlock resolves with a digest even
      // when the tx executed but ABORTED (MoveAbort / InsufficientGas) — an RPC-level success that
      // is NOT execution success. Ask for effects so we can tell the two apart.
      options: { showEffects: true },
    })
  )

  if (error) {
    await verifyBroadcastByHash({ chain, tx, error })
    return
  }

  if (!response) {
    return
  }

  // Mirror the status resolver (status/resolvers/sui.ts): ONLY an explicit 'success' effects status
  // is execution success. A 'failure' (MoveAbort / InsufficientGas) — or a missing/unknown status —
  // must NOT be returned as a digest-carrying successful broadcast (that's the sdk#1398 bug). Thrown
  // outside the RPC-error path above so it isn't fed back into verifyBroadcastByHash — the tx is
  // on-chain and failed, not un-broadcast.
  //
  // Throw DeliverTxFailedError (not a bare Error) so isTransientBroadcastError short-circuits on the
  // `instanceof` BEFORE its message-regex runs: a Sui abort error string routinely contains
  // "aborted"/"timed out", which the transient patterns match — a bare Error would be misclassified
  // as transient and the aborted tx re-sent by withTransientBroadcastRetry.
  assertSuiTxSucceeded(response.effects)

  return response
}
