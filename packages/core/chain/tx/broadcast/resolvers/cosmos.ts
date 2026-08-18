import { assertIsDeliverTxSuccess, TimeoutError } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { toCosmosSequenceMismatchError } from '../cosmosSequenceMismatch'
import { BroadcastTxResolver } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export { CosmosSequenceMismatchError, toCosmosSequenceMismatchError } from '../cosmosSequenceMismatch'

export const getCosmosBroadcastTimeoutTxId = (error: unknown): string | undefined => {
  if (!(error instanceof TimeoutError)) return undefined

  const { txId } = error

  return txId.trim() || undefined
}

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({ chain, tx }) => {
  const { serialized } = tx
  const { tx_bytes } = JSON.parse(serialized)
  const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

  const client = await getCosmosClient(chain)
  const { data, error } = await attempt(client.broadcastTx(decodedTxBytes))

  if (data) {
    // client.broadcastTx resolves (does not throw) once the tx is INCLUDED in a
    // block, even when execution itself failed (DeliverTx code !== 0 — e.g.
    // out-of-gas, wasm revert, a THORChain/Maya deposit-handler rejection). The
    // tx is on-chain but nothing moved, so this must not be reported as success.
    try {
      assertIsDeliverTxSuccess(data)
    } catch (deliverTxError) {
      // Marker type, not a bare Error: cosmos has no resolver-owned retry, so
      // this throws into `withTransientBroadcastRetry`. A rawLog like "wasm
      // contract aborted" would otherwise match the transient message regex
      // and get resent, then swallowed as an idempotent "already in cache"
      // success — reopening the bug this assert exists to close.
      const message = deliverTxError instanceof Error ? deliverTxError.message : String(deliverTxError)
      throw new DeliverTxFailedError(message, { cause: deliverTxError })
    }
    return
  }

  if (isInError(error, 'tx already exists in cache')) {
    return
  }

  const timeoutTxId = getCosmosBroadcastTimeoutTxId(error)
  if (timeoutTxId) {
    return timeoutTxId
  }

  // Keep the hash-verification safety net first: another MPC participant may
  // have successfully broadcast these same bytes just before this node returned
  // a sequence rejection. When the hash is genuinely unknown, replace the raw
  // code-32 message with direction-aware recovery guidance.
  await verifyBroadcastByHash({ chain, tx, error: toCosmosSequenceMismatchError(error) ?? error })
}
