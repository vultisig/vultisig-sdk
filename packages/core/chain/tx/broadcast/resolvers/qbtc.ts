import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { waitForQbtcTxInclusion } from '@vultisig/core-chain/chains/cosmos/qbtc/waitForQbtcTxInclusion'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

// QBTC block time is ~5-7s; give a DeliverTx a generous window to land before treating the tx as
// in-flight (the status resolver reports the final code either way).
const QBTC_INCLUSION_TIMEOUT_MS = 30_000
const QBTC_INCLUSION_POLL_INTERVAL_MS = 1_000

export const broadcastQbtcTx: BroadcastTxResolver<typeof Chain.QBTC> = async ({ chain, tx }) => {
  const { serialized } = tx
  const { tx_bytes } = JSON.parse(serialized) as { tx_bytes: string }

  const resp = await fetch(`${qbtcRestUrl}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes,
      mode: 'BROADCAST_MODE_SYNC',
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    if (isInError(text, 'tx already exists in cache')) {
      return
    }
    const err = new Error(`QBTC broadcast failed (${resp.status}): ${text}`)
    await verifyBroadcastByHash({ chain, tx, error: err })
    return
  }

  const data = (await resp.json()) as {
    tx_response?: { code?: number; txhash?: string; raw_log?: string; log?: string }
  }
  const checkTx = data.tx_response

  // CheckTx (mempool admission). A missing code, or a non-zero code, is NOT a confirmed on-chain
  // state — verify by hash rather than trusting it. Reading it as `code && code !== 0` (the old
  // guard) treated a MISSING tx_response as a silent success: half of this false-success bug.
  if (typeof checkTx?.code !== 'number' || checkTx.code !== 0) {
    const log = checkTx?.raw_log || checkTx?.log
    if (log && isInError(log, 'tx already exists in cache')) {
      return
    }
    const err = new Error(`QBTC CheckTx failed: ${log ?? 'missing tx_response.code'}`)
    await verifyBroadcastByHash({ chain, tx, error: err })
    return
  }

  // CheckTx passed — but BROADCAST_MODE_SYNC only surfaces CheckTx. A DeliverTx failure (out-of-gas,
  // execution revert) still comes back code=0 HERE, so returning now would report an on-chain tx that
  // moved nothing as a success. Poll for inclusion and re-check the DeliverTx code (mirrors the QBTC
  // claim helper, broadcastClaimTx). A CONFIRMED DeliverTx failure throws a non-retryable
  // DeliverTxFailedError; if we cannot confirm within the window (timeout / transient RPC error) the
  // tx is in the mempool, not failed, so leave it in-flight — the status resolver reports the final
  // code.
  const txHash = checkTx.txhash
  if (!txHash) {
    await verifyBroadcastByHash({ chain, tx, error: new Error('QBTC broadcast: missing txhash on CheckTx response') })
    return
  }

  const { data: included, error: inclusionError } = await attempt(
    waitForQbtcTxInclusion({
      txHash,
      timeoutMs: QBTC_INCLUSION_TIMEOUT_MS,
      intervalMs: QBTC_INCLUSION_POLL_INTERVAL_MS,
    })
  )

  if (inclusionError || included === undefined || typeof included.code !== 'number') {
    return
  }

  if (included.code !== 0) {
    throw new DeliverTxFailedError(`QBTC transaction execution failed: ${included.raw_log || included.log}`)
  }
}
