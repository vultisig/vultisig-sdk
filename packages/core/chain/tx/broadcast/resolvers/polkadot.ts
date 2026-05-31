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
 * Substrate Pool errors that mean "this extrinsic is already in the pool /
 * imported / banned because a peer just submitted it." In an MPC ceremony,
 * the initiator and the joiner both broadcast the same signed extrinsic; the
 * slower device hits exactly these messages while the tx is in fact already
 * on chain. Treat them as idempotent successes — the alternative is showing
 * the slower device a "Signing Error" screen for a transaction that did
 * confirm. Fast path so we don't rely on `verifyBroadcastByHash`, which can't
 * help on Polkadot until tx-status polling moves off the gated Subscan API.
 *
 * Substrate sources for the exact strings:
 *   substrate/client/transaction-pool/api/src/error.rs (AlreadyImported,
 *   TemporarilyBanned, NoTagsProvided, ImmediatelyDropped) and
 *   primitives/runtime/src/transaction_validity.rs (Stale).
 */
const idempotentBroadcastErrorPatterns: readonly RegExp[] = [
  /already imported/i,
  /already known/i,
  /temporarily banned/i,
]

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
