import { OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

/**
 * Engine result codes from XRPL `submit` that indicate the tx may already
 * be on-chain via another MPC peer's broadcast (peer-race recovery path).
 *
 * `tefALREADY` — exact duplicate already seen; the fast peer landed it.
 * `tefPAST_SEQ` — sequence number behind; the fast peer's tx already
 *   consumed this sequence.
 *
 * For these we go through `verifyBroadcastByHash` to confirm the tx is
 * actually on-chain before swallowing the duplicate error. Any OTHER
 * non-success engine result (`tem*` malformed, `tec*` claim failures,
 * `tel*` local-policy rejections, `ter*` retry-later, the remaining
 * `tef*` failures) is the chain's authoritative "no" at preflight —
 * propagate directly so the caller sees the real failure.
 *
 * Going through `verifyBroadcastByHash` for non-peer-race rejections
 * would silently swallow the error: `getRippleTxStatus` returns
 * `'pending'` for `txnNotFound`, and the safety net treats `'pending'`
 * as "tx is in flight" (correct for EVM-style chains, wrong for XRPL
 * where rejected txs are never on-chain).
 */
const PEER_RACE_ENGINE_RESULTS = new Set(['tefALREADY', 'tefPAST_SEQ'])

export const broadcastRippleTx: BroadcastTxResolver<
  OtherChain.Ripple
> = async ({ chain, tx }) => {
  const client = await getRippleClient()

  // RPC-level errors (network blip, connection drop) get the safety-net
  // verify-by-hash path: another peer's broadcast may have landed the tx.
  let response
  try {
    response = await client.request({
      command: 'submit',
      tx_blob: Buffer.from(tx.encoded).toString('hex'),
    })
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
    return
  }

  const engineResultCode = response?.result?.engine_result_code
  if (typeof engineResultCode !== 'number' || engineResultCode === 0) {
    // tesSUCCESS (applied / queued for next ledger). All good.
    return
  }

  const engineResult = response.result.engine_result ?? 'unknown'
  const engineResultMessage = response.result.engine_result_message ?? ''
  const error = new Error(
    `Ripple broadcast rejected: ${engineResult}${engineResultMessage ? ` — ${engineResultMessage}` : ''}`
  )

  if (PEER_RACE_ENGINE_RESULTS.has(engineResult)) {
    // Duplicate / past-sequence: fast MPC peer's broadcast may have
    // already landed the tx. Verify before swallowing.
    await verifyBroadcastByHash({ chain, tx, error })
    return
  }

  // Authoritative rejection at preflight (tem*/tec*/tel*/ter*/remaining tef*).
  // Propagate so the caller sees the real failure instead of a fake hash.
  throw error
}
