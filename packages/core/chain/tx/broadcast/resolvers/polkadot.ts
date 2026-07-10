import { OtherChain } from '@vultisig/core-chain/Chain'
import { ensureHexPrefix } from '@vultisig/lib-utils/hex/ensureHexPrefix'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { polkadotRpcUrl } from '../../../chains/polkadot/client'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

type RpcResponse = {
  result?: string
  error?: { code: number; message: string; data?: string }
}

/**
 * Substrate Pool errors that UNAMBIGUOUSLY mean "this exact extrinsic is
 * already in the pool because a peer just submitted it." In an MPC ceremony
 * the initiator and joiner both broadcast the same signed extrinsic; the
 * slower device hits exactly these messages while the tx is in fact already
 * accepted. Treat them as idempotent successes — the alternative is showing
 * the slower device a "Signing Error" screen for a tx that did confirm.
 *
 * `temporarily banned` is deliberately NOT in this list. Substrate's pool
 * bans a tx hash for a cool-off window whenever it was recently *removed* —
 * which includes both a benign already-processed duplicate AND a genuine
 * rejection (invalid/dropped extrinsic that got banned to stop retry spam).
 * The string alone cannot tell those apart, so assuming success would report
 * a genuinely-rejected tx as confirmed (fund-safety false positive). It is
 * routed through `verifyBroadcastByHash` instead, which only swallows the
 * error if the tx hash is actually observed on chain / in the pool and
 * otherwise surfaces the real failure.
 *
 * Substrate sources for the exact strings:
 *   substrate/client/transaction-pool/api/src/error.rs (AlreadyImported,
 *   TemporarilyBanned, NoTagsProvided, ImmediatelyDropped) and
 *   primitives/runtime/src/transaction_validity.rs (Stale).
 */
const idempotentBroadcastErrorPatterns: readonly RegExp[] = [/already imported/i, /already known/i]

const isIdempotentBroadcastError = (text: string): boolean =>
  idempotentBroadcastErrorPatterns.some(pattern => pattern.test(text))

/**
 * Substrate's JSON-RPC error shape is `{ code, message, data? }`. For
 * `InvalidTransaction::*` rejections (code 1010) the `message` is the
 * generic `"Invalid Transaction"` and the specific reason ("Transaction has
 * a bad signature", "Transaction is outdated", "Inability to pay some fees",
 * etc.) lives in `data`. Surfacing only `message` makes every failure look
 * identical in the UI and strips the information we need to triage.
 */
const formatRpcError = ({ code, message, data }: { code: number; message: string; data?: string }): string => {
  const head = message ?? `code ${code}`
  return data ? `${head}: ${data}` : head
}

export const broadcastPolkadotTx: BroadcastTxResolver<OtherChain.Polkadot> = async ({ chain, tx }) => {
  const hexWithPrefix = ensureHexPrefix(Buffer.from(tx.encoded).toString('hex'))

  try {
    const response = await queryUrl<RpcResponse>(polkadotRpcUrl, {
      body: {
        jsonrpc: '2.0',
        method: 'author_submitExtrinsic',
        params: [hexWithPrefix],
        id: 1,
      },
    })

    if (response.error) {
      // Slow device in an MPC peer race — the initiator (or any other peer)
      // already submitted this exact tx; the node tells us with a Pool error
      // (string usually in `message`) or, less commonly, an Invalid
      // Transaction variant whose duplicate signal lives in `data`.
      const errorText = `${response.error.message ?? ''} ${response.error.data ?? ''}`
      if (isIdempotentBroadcastError(errorText)) {
        return
      }
      throw new Error(`Polkadot broadcast failed: ${formatRpcError(response.error)}`)
    }

    // Per JSON-RPC 2.0 a valid response must have exactly one of `result` /
    // `error`. If both are missing (malformed gateway response, truncated
    // body, …) do not silently assume success — force hash verification.
    if (!response.result) {
      throw new Error('Polkadot broadcast failed: missing extrinsic hash in RPC response')
    }
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
