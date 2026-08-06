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
 * Anchored tightly on the cosmjs skeleton so chain-controlled text can't spoof it:
 * - the hash is exactly 64 hex chars (a Cosmos SHA-256 tx hash — cosmjs's
 *   `transactionHash`), not an open `[0-9a-f]+` a program log could fake;
 * - the code is a nonzero integer (`isDeliverTxFailure` fires only on `code !== 0`);
 * - `.match` returns the FIRST occurrence, which is always the genuine outermost
 *   message (a rawLog echoing the phrasing is appended last).
 *
 * This is only the SHAPE test. Callers additionally chain-gate — the classifier off
 * the SDK wrapper on the error's own message, the guard off the intent's own chain —
 * so a foreign chain's program log (Solana folds program-controlled logs into the
 * broadcast error) can never route through this path. Mirrors #1355's rule that chain
 * identity comes from the wrapper, never from wrapped payload text.
 */
const COSMOS_DELIVERTX_FAILURE_RE =
  /error when broadcasting tx ([0-9a-f]{64}) at height \d+\. code: [1-9]\d*; raw log:/i

/**
 * If `text` carries a cosmjs DeliverTx-failure message, return the on-chain tx hash
 * cosmjs embedded in it; otherwise `undefined`. `text` may be the wrapped VaultError
 * message, the raw cosmjs message, or the two concatenated — the regex locates the
 * substring either way. NOT sufficient on its own: the caller must have already
 * established the error belongs to a Cosmos-family broadcast (see the note above).
 */
export function matchCosmosDeliverTxFailure(text: string): { hash: string } | undefined {
  const match = text.match(COSMOS_DELIVERTX_FAILURE_RE)
  if (!match) return undefined
  return { hash: match[1] }
}
