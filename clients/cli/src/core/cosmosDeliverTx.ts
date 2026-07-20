/**
 * A Cosmos transaction can be INCLUDED in a block and still FAIL execution
 * (DeliverTx code !== 0 — out-of-gas, a wasm revert, a THORChain/Maya
 * deposit-handler rejection). cosmjs's `assertIsDeliverTxSuccess` surfaces that as
 * this exact message, which the SDK's broadcast resolver rethrows as
 * `DeliverTxFailedError` and BroadcastService wraps into `VaultError(BroadcastFailed)`
 * as `Failed to broadcast transaction on <Chain>: <this message>`.
 * See packages/core/chain/tx/broadcast/resolvers/cosmos.ts.
 *
 * The message shape is verbatim from cosmjs (@cosmjs/stargate stargateclient.js):
 *   `Error when broadcasting tx ${hash} at height ${height}. Code: ${code}; Raw log: ${rawLog}`
 *
 * Recognizing it matters because a DeliverTx failure is TERMINAL, and the distinction
 * from a CheckTx rejection is the whole point: a CheckTx rejection never touched the
 * chain (sequence intact → the identical bytes stay replayable, which is why
 * `COSMOS_PERMANENT_SDK_CODES` keeps codes 5/9/13 retryable). A DeliverTx failure DID
 * touch the chain — the sequence is consumed and the gas is spent — so the identical
 * signed bytes can never re-land, whatever the code.
 *
 * Anchored on the `at height <digits>. Code: <digits>; Raw log:` skeleton (not the
 * chain-controlled hash or rawLog) so a rawLog that happens to echo the phrasing can't
 * spoof a match: `.match` returns the FIRST occurrence, which is always the genuine
 * outermost message (the rawLog is appended last).
 */
const COSMOS_DELIVERTX_FAILURE_RE = /error when broadcasting tx ([0-9a-f]+) at height \d+\. code: \d+; raw log:/i

/**
 * If `text` carries a cosmjs DeliverTx-failure message, return the on-chain tx hash
 * cosmjs embedded in it; otherwise `undefined`. `text` may be the wrapped VaultError
 * message, the raw cosmjs message, or the two concatenated — the regex locates the
 * substring either way.
 */
export function matchCosmosDeliverTxFailure(text: string): { hash: string } | undefined {
  const match = text.match(COSMOS_DELIVERTX_FAILURE_RE)
  if (!match) return undefined
  return { hash: match[1] }
}
