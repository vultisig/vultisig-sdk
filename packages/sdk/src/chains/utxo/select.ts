/**
 * Coin selection for UTXO sends (UTXO-01).
 *
 * `getUtxos` fetches every unspent output for an address; `buildUtxoSendTx`
 * takes a pre-selected `utxos` array and its doc comment says "caller
 * handles coin-selection" — but no selection layer existed. Callers (the
 * SDK's own examples + vultiagent-app) fetched every UTXO and passed the
 * FULL array through verbatim. Effects:
 *   - overpays fees for all N inputs when a handful would cover the send
 *   - false "insufficient funds" when fee(N) > balance even though a subset
 *     would cover amount + fee
 *   - links every UTXO the wallet owns in one tx (privacy)
 *
 * `selectUtxoInputs` closes the gap: it picks the smallest largest-first
 * prefix of `utxos` whose total covers `amount + fee(k)`, recomputing the
 * fee at each step via `estimateUtxoTxFee` — the SAME size/fee formula
 * `buildUtxoSendTx` itself uses, so selection and build always agree.
 *
 * Algorithm: accumulative / greedy, largest-first. This is the simplest
 * correct strategy and minimizes input count (fewer inputs → lower fee →
 * fewer signatures to produce), at the cost of being non-optimal on change
 * (branch-and-bound could sometimes find an exact/zero-change cover a
 * largest-first walk misses). That tradeoff is acceptable for v1: the
 * dominant harms (fee overpay, false insufficient-funds, full-wallet
 * linkage) are all fixed by ANY correct minimal-covering-subset selection,
 * and largest-first is the lowest-risk change to reason about and test
 * across 6 chains with materially different fee/dust constants.
 *
 * Recompute-per-step, not "add then rebalance": because `estimateUtxoTxFee`
 * depends only on the input COUNT (not which UTXOs were chosen), fee(k) is
 * fully determined before we know which UTXO breaks the threshold. We still
 * recompute it fresh on every iteration (rather than precomputing a fee
 * curve) so a future fee formula that also considers input VALUES (e.g.
 * distinguishing P2SH-wrapped vs native inputs) stays correct without
 * touching this file.
 *
 * Dust is intentionally NOT special-cased here: `buildUtxoSendTx`'s
 * `serializeOutputs` already folds a change output below the chain's
 * `dustLimit` into the fee (see `hasChange` there), so a selection that
 * lands with `0 < change <= dustLimit` still produces a valid,
 * standard-relay tx — it just pays a marginally higher effective fee. That
 * mirrors how wallets typically handle sub-dust change and avoids adding a
 * second, independently-tunable dust-avoidance knob here.
 */
import { estimateUtxoTxFee, type UtxoChainName, type UtxoInput } from './tx'

export type SelectUtxoInputsOptions = {
  chain: UtxoChainName
  /** Every candidate UTXO available to spend from — e.g. straight off `getUtxos`. */
  utxos: UtxoInput[]
  /** Amount in base units to send, excluding fee. */
  amount: bigint
  /** Fee rate in sats/byte — pass the same value to `buildUtxoSendTx`. */
  feeRate: number
  /**
   * Present iff the tx also carries an OP_RETURN memo. MUST match the
   * `opReturnData` passed to `buildUtxoSendTx` — the memo's byte length
   * feeds fee estimation, so a mismatch here would make selection and
   * build disagree on the fee.
   */
  opReturnData?: string
  /**
   * Consume every UTXO regardless of whether a smaller subset would cover
   * `amount + fee` — for "send entire balance" flows, where leaving UTXOs
   * unspent would defeat the purpose. Callers in this mode should already
   * have computed `amount` as balance-minus-fee; this still validates that
   * the full set actually covers `amount + fee(N)`.
   */
  sendMax?: boolean
}

export type SelectUtxoInputsResult = {
  /** Selected UTXOs, ready to pass verbatim as `buildUtxoSendTx`'s `utxos`. */
  inputs: UtxoInput[]
  /** The fee `buildUtxoSendTx` will charge for this exact input set. */
  fee: bigint
  /**
   * `selectedTotal - amount - fee`. May be below the chain's dust
   * threshold — `buildUtxoSendTx` folds that into the fee rather than
   * emitting a dust output (see module doc).
   */
  change: bigint
}

function insufficientFundsError(have: bigint, amount: bigint, fee: bigint): Error {
  // Mirrors buildUtxoSendTx's own "insufficient funds" message shape so a
  // caller that goes straight to buildUtxoSendTx (bypassing selection, or
  // hitting the same wall inside selection) sees one consistent error text.
  return new Error(`insufficient funds: have=${have} need=${amount + fee} (amount=${amount} fee=${fee})`)
}

/**
 * Select the minimal largest-first-sorted prefix of `utxos` that covers
 * `amount + fee(k)`. Throws the same "insufficient funds" shape
 * `buildUtxoSendTx` throws when even the full UTXO set can't cover the send.
 */
export function selectUtxoInputs(opts: SelectUtxoInputsOptions): SelectUtxoInputsResult {
  if (opts.utxos.length === 0) throw new Error('no UTXOs provided')
  if (opts.amount <= 0n) throw new Error('amount must be greater than zero')

  if (opts.sendMax) {
    const inputs = [...opts.utxos]
    const total = inputs.reduce((sum, u) => sum + u.value, 0n)
    const fee = estimateUtxoTxFee(opts.chain, inputs.length, opts.feeRate, opts.opReturnData)
    if (total < opts.amount + fee) throw insufficientFundsError(total, opts.amount, fee)
    return { inputs, fee, change: total - opts.amount - fee }
  }

  const sorted = [...opts.utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
  const selected: UtxoInput[] = []
  let selectedTotal = 0n

  for (const utxo of sorted) {
    selected.push(utxo)
    selectedTotal += utxo.value
    const fee = estimateUtxoTxFee(opts.chain, selected.length, opts.feeRate, opts.opReturnData)
    if (selectedTotal >= opts.amount + fee) {
      return { inputs: selected, fee, change: selectedTotal - opts.amount - fee }
    }
  }

  const fee = estimateUtxoTxFee(opts.chain, selected.length, opts.feeRate, opts.opReturnData)
  throw insufficientFundsError(selectedTotal, opts.amount, fee)
}
