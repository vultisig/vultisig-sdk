import { assertIsDeliverTxSuccess, BroadcastTxError, TimeoutError } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'
import { DeliverTxFailedError, NodeRejectedBroadcastError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

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

  // BroadcastTxError means the node evaluated THESE bytes via CheckTx and
  // rejected them — a deterministic, terminal outcome, not a transport
  // failure. On a node with `keep-invalid-txs-in-cache=true`, CometBFT caches
  // a rejected tx's hash the same as an accepted one, so if this got
  // misclassified as transient and retried, the resend could come back "tx
  // already exists in cache" purely from the rejection's own cache entry and
  // get swallowed as success. Wrap it so the retry wrapper never resends;
  // still route through hash verification, since a peer device may have
  // independently broadcast the same signed bytes successfully in the
  // meantime.
  const verifyError =
    error instanceof BroadcastTxError ? new NodeRejectedBroadcastError(error.message, { cause: error }) : error

  await verifyBroadcastByHash({ chain, tx, error: verifyError })
}
