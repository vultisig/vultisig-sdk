import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'
import { attempt } from '@vultisig/lib-utils/attempt'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

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

  // Mirror the status resolver (status/resolvers/sui.ts): a 'failure' effects status is a
  // genuinely-failed Move, so throw instead of returning a digest as a successful broadcast. Thrown
  // outside the RPC-error path above so it isn't fed back into verifyBroadcastByHash — the tx is
  // on-chain and failed, not un-broadcast.
  if (response.effects?.status?.status === 'failure') {
    throw new Error(`Sui transaction failed on-chain: ${response.effects.status.error ?? 'transaction aborted'}`)
  }

  return response
}
