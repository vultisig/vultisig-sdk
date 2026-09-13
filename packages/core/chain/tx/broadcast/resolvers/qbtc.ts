import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { waitForQbtcTxInclusion } from '@vultisig/core-chain/chains/cosmos/qbtc/waitForQbtcTxInclusion'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { HttpResponseError } from '@vultisig/lib-utils/fetch/HttpResponseError'

import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { DeliverTxFailedError } from '../transientRetry'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

// QBTC block time is ~5-7s; give a DeliverTx a generous window to land before treating the tx as
// in-flight (the status resolver reports the final code either way).
const QBTC_INCLUSION_TIMEOUT_MS = 30_000
const QBTC_INCLUSION_POLL_INTERVAL_MS = 1_000

export const broadcastQbtcTx: BroadcastTxResolver<typeof Chain.QBTC> = async ({ chain, tx }) => {
  try {
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
        return broadcastAccepted()
      }
      const err = new HttpResponseError({
        message: `QBTC broadcast failed (${resp.status}): ${text}`,
        status: resp.status,
        statusText: resp.statusText,
        url: resp.url || `${qbtcRestUrl}/cosmos/tx/v1beta1/txs`,
        body: text,
      })
      try {
        return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error: err }))
      } catch (cause) {
        return broadcastFailed(cause, isRetryableBroadcastCause(err))
      }
    }

    const data = (await resp.json()) as {
      tx_response?: { code?: number; txhash?: string; raw_log?: string; log?: string }
    }
    const checkTx = data.tx_response

    if (typeof checkTx?.code !== 'number' || checkTx.code !== 0) {
      const log = checkTx?.raw_log || checkTx?.log
      if (log && isInError(log, 'tx already exists in cache')) {
        return broadcastAccepted()
      }
      const error = new Error(`QBTC CheckTx failed: ${log ?? 'missing tx_response.code'}`)
      try {
        return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
      } catch (cause) {
        return broadcastFailed(cause, false)
      }
    }

    const txHash = checkTx.txhash
    if (!txHash) {
      const error = new Error('QBTC broadcast: missing txhash on CheckTx response')
      try {
        return broadcastAccepted(await verifyBroadcastByHash({ chain, tx, error }))
      } catch (cause) {
        return broadcastFailed(cause, false)
      }
    }

    const { data: included, error: inclusionError } = await attempt(
      waitForQbtcTxInclusion({
        txHash,
        timeoutMs: QBTC_INCLUSION_TIMEOUT_MS,
        intervalMs: QBTC_INCLUSION_POLL_INTERVAL_MS,
      })
    )

    if (inclusionError || included === undefined || typeof included.code !== 'number') {
      return broadcastAccepted(txHash)
    }

    if (included.code !== 0) {
      return broadcastFailed(
        new DeliverTxFailedError(`QBTC transaction execution failed: ${included.raw_log || included.log}`),
        false
      )
    }

    return broadcastAccepted(txHash, { provider: included })
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
