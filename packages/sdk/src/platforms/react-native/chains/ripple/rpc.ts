/**
 * XRP Ledger RPC helpers — fetch-based so they run under Hermes.
 *
 * The Ripple JSON-RPC envelope is `{method, params: [{...}]}` (single-element
 * params array) and the response shape is `{result: {...}}`. This is NOT the
 * standard JSON-RPC 2.0 shape (`jsonrpc`, `id`, `error`), so we call `fetch`
 * directly instead of using `jsonRpcCall` from `../../rpcFetch.ts`.
 */

type RippleResponse<T> = {
  result: T & { status?: string; error?: string; error_message?: string }
}

/**
 * Expected-error codes surfaced by XRPL that represent a normal business
 * outcome (not a protocol error). Callers branch on these instead of
 * treating every `status: 'error'` as a thrown exception.
 */
const EXPECTED_RIPPLE_ERRORS = new Set(['actNotFound'])

async function rippleCall<T>(
  rpcUrl: string,
  method: string,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
    signal,
  })
  if (!res.ok) {
    // Include a truncated body preview — XRPL gateways behind rate-limiters /
    // CDNs frequently return HTML or JSON error envelopes that carry the real
    // failure reason (auth, throttle, geo block). Without it, ops sees a bare
    // 403/429/5xx and has to re-run by hand to diagnose.
    const preview = await res.text().catch(() => '')
    throw new Error(`XRP RPC HTTP ${res.status} ${res.statusText} from ${rpcUrl}: ${preview.slice(0, 256)}`)
  }
  const payload = (await res.json()) as RippleResponse<T>
  const result = payload.result
  if (!result) {
    throw new Error(`XRP RPC missing result: ${JSON.stringify(payload)}`)
  }
  // XRPL returns `status: "error"` for several expected cases — notably
  // `actNotFound` for unfunded accounts. Treat those as a valid response
  // (the caller inspects `result.error` to branch) and only throw for
  // genuinely unexpected protocol-level errors.
  if (result.status === 'error' && !EXPECTED_RIPPLE_ERRORS.has(result.error ?? '')) {
    throw new Error(`XRP RPC error: ${result.error ?? 'unknown'} — ${result.error_message ?? ''}`)
  }
  return result
}

// ---------------------------------------------------------------------------
// account_info — sequence, balance (drops), flags
// ---------------------------------------------------------------------------

export type XrpAccountInfo = {
  /** Classic r-address. */
  address: string
  /** Current account sequence — pass to buildXrpSendTx. */
  sequence: number
  /** Balance in drops (string, preserves precision). */
  balanceDrops: string
  /** Account Flags bitmask. */
  flags: number
  /** Whether the account has been funded. When false, `sequence`/`balance` are undefined upstream. */
  funded: boolean
}

type AccountInfoResult = {
  account_data?: {
    Account: string
    Balance: string
    Flags: number
    Sequence: number
  }
  error?: string
}

/**
 * Fetch sequence + balance for an XRP address.
 *
 * Returns `funded: false` (with `sequence: 0` and `balanceDrops: '0'`) when
 * the address is not yet activated on-chain (`actNotFound`) or when the
 * server returns an empty `account_data` envelope. Activation requires a
 * minimum reserve of XRP, so an unfunded account is the expected first-time
 * state for a fresh receive address — the caller decides whether to proceed
 * with a top-up tx or abort.
 *
 * Throws only for transport-level / unexpected RPC failures (everything
 * other than `actNotFound`), which `rippleCall` surfaces directly.
 */
export async function getXrpAccountInfo(
  address: string,
  rpcUrl: string,
  signal?: AbortSignal
): Promise<XrpAccountInfo> {
  const result = await rippleCall<AccountInfoResult>(
    rpcUrl,
    'account_info',
    { account: address, strict: true, ledger_index: 'current' },
    signal
  )
  if (result.error === 'actNotFound' || !result.account_data) {
    return {
      address,
      sequence: 0,
      balanceDrops: '0',
      flags: 0,
      funded: false,
    }
  }
  return {
    address,
    sequence: result.account_data.Sequence,
    balanceDrops: result.account_data.Balance,
    flags: result.account_data.Flags,
    funded: true,
  }
}

/**
 * Convenience wrapper — returns balance in drops (string) for the given
 * address. Returns `"0"` for unfunded accounts.
 */
export async function getXrpBalance(address: string, rpcUrl: string, signal?: AbortSignal): Promise<string> {
  const info = await getXrpAccountInfo(address, rpcUrl, signal)
  return info.balanceDrops
}

// ---------------------------------------------------------------------------
// ledger — current validated ledger index (for LastLedgerSequence)
// ---------------------------------------------------------------------------

type LedgerResult = {
  ledger_index?: number
  ledger_current_index?: number
  ledger?: { ledger_index?: number | string }
}

/**
 * Return the current ledger index. Consumers typically add a safety margin
 * (e.g., +4) and set that as `LastLedgerSequence` on the tx so it expires
 * if not validated within a handful of ledgers.
 */
export async function getXrpLedgerCurrentIndex(rpcUrl: string, signal?: AbortSignal): Promise<number> {
  const result = await rippleCall<LedgerResult>(rpcUrl, 'ledger', { ledger_index: 'current' }, signal)
  const idx =
    result.ledger_current_index ??
    result.ledger_index ??
    (typeof result.ledger?.ledger_index === 'string' ? Number(result.ledger.ledger_index) : result.ledger?.ledger_index)
  if (typeof idx !== 'number' || !Number.isFinite(idx)) {
    throw new Error(`XRP ledger response missing current index: ${JSON.stringify(result)}`)
  }
  return idx
}

// ---------------------------------------------------------------------------
// submit — broadcast a signed tx blob
//
// `submitXrpTx` is the app's ONLY XRP broadcast call site (`xrpTx.ts`'s
// `buildSignBroadcastXrpSend` calls it directly) — this is NOT a dead/unused
// helper.
//
// XRPL `submit` returns one of several engine-result classes (`tes*`, `tec*`,
// `ter*`, `tem*`, `tef*`, `tel*`). `tesSUCCESS`/`terQUEUED` are provisional
// success. `tec*` is a half-truth: it means the tx WAS applied on-ledger
// (fee + sequence consumed) even though the requested operation itself
// failed — it is NOT the same as "never broadcast". A caller that treats a
// thrown `tec*` error as proof the tx stayed off-ledger and naively retries
// with the same `Sequence` risks a `tefPAST_SEQ` (or worse, a fund-loss race
// if the fee has changed) on the retry.
//
// `submitXrpTx` verifies on-ledger state for `tec*` results before deciding
// what to throw: a `tx` JSON-RPC lookup by hash distinguishes confirmed
// (definitive fee/sequence-consumed failure, or a canonical-ordering flip
// to an actual success), not-yet-validated (transient, ledgers close ~4s,
// not a hard failure), and unconfirmed (lookup failed/not-found — does NOT
// prove the tx never landed, see `XrpSubmitRejectionReason`). Verification
// only sharpens the thrown error; it is never a path to reporting false
// success, and an unconfirmed lookup is never claimed to be "safe to retry"
// the way a genuine preflight rejection (`tem*`/`tel*`/`tef*`/`ter*`) is.
// ---------------------------------------------------------------------------

export type XrpSubmitResult = {
  engineResult: string
  engineResultMessage: string
  txHash: string | undefined
  accepted: boolean
}

/**
 * Why a submit-rejection is fund-relevant or not:
 *  - `on-ledger-tec` — a `tec*` result confirmed against the ledger by
 *    hash: the tx WAS included in a validated ledger (fee + sequence
 *    consumed), the requested operation itself failed. Retrying with the
 *    same `Sequence` will fail (`tefPAST_SEQ`) or worse race a fee change.
 *  - `pending-validation` — a `tec*` result whose tx was found by hash but
 *    hasn't reached a validated ledger yet (expected right after submit —
 *    ledgers close every ~4s). Transient: NOT proof the tx landed, NOT
 *    proof it didn't. The caller should re-check by hash rather than
 *    either assume success or blindly resubmit with the same sequence.
 *  - `tec-lookup-unconfirmed` — a `tec*` result whose hash lookup errored
 *    (including `txnNotFound`) or returned no hash to check at all. A
 *    single failed lookup does NOT prove the tx never landed — it may
 *    simply not have propagated to the queried node yet. Do NOT treat
 *    this as safe to resubmit with the same sequence; re-check by hash,
 *    or wait for the network's validated ledger index to pass this tx's
 *    `LastLedgerSequence` before concluding it's dead.
 *  - `not-on-ledger` — a non-`tec*` rejection (`tem*`/`tel*`/`tef*`/`ter*`).
 *    These are preflight rejections XRPL returns BEFORE the tx is applied
 *    to any ledger, so no fee/sequence was ever consumed — genuinely safe
 *    to retry with the same sequence.
 */
export type XrpSubmitRejectionReason =
  | 'on-ledger-tec'
  | 'pending-validation'
  | 'tec-lookup-unconfirmed'
  | 'not-on-ledger'

/**
 * Typed rejection from `submitXrpTx` — callers should branch on `reason`
 * rather than parsing the message string. `reason === 'on-ledger-tec'` is
 * the case that matters most: the fee/sequence were consumed on-chain even
 * though the transfer itself failed, so a naive same-sequence retry is
 * unsafe.
 */
export class XrpSubmitRejectedError extends Error {
  readonly reason: XrpSubmitRejectionReason
  readonly engineResult: string
  readonly engineResultMessage: string
  readonly txHash: string | undefined

  constructor(params: {
    reason: XrpSubmitRejectionReason
    engineResult: string
    engineResultMessage: string
    txHash: string | undefined
  }) {
    const { reason, engineResult, engineResultMessage, txHash } = params
    const message = (() => {
      switch (reason) {
        case 'on-ledger-tec':
          return (
            `XRP submit applied on-ledger with a failed result (fee + sequence consumed, transfer NOT completed): ` +
            `${engineResult} — ${engineResultMessage}. txHash=${txHash}. Do not retry with the same sequence.`
          )
        case 'pending-validation':
          return (
            `XRP submit returned ${engineResult} — ${engineResultMessage}. txHash=${txHash} was found but has not ` +
            `reached a validated ledger yet. This is not a definitive failure — re-check by hash before deciding ` +
            `whether to resubmit with the same sequence.`
          )
        case 'tec-lookup-unconfirmed':
          return (
            `XRP submit returned ${engineResult} — ${engineResultMessage}. txHash=${txHash} could not be ` +
            `confirmed on-ledger (lookup failed or transaction not found). This does NOT prove the tx never ` +
            `landed — do not resubmit with the same sequence until you've re-checked by hash or the network's ` +
            `validated ledger index has passed this tx's LastLedgerSequence.`
          )
        case 'not-on-ledger':
          return `XRP submit rejected: ${engineResult || 'unknown'} — ${engineResultMessage}`
      }
    })()
    super(message)
    this.name = 'XrpSubmitRejectedError'
    this.reason = reason
    this.engineResult = engineResult
    this.engineResultMessage = engineResultMessage
    this.txHash = txHash
  }
}

type SubmitResult = {
  engine_result?: string
  engine_result_message?: string
  tx_json?: { hash?: string }
  accepted?: boolean
}

type TxLookupResult = {
  validated?: boolean
  meta?: { TransactionResult?: string }
}

/**
 * Three-way outcome of a post-submit `tx`-by-hash lookup:
 *  - `validated` — the ledger confirms a final result for this tx hash.
 *    `transactionResult` is the definitive outcome — it may differ from
 *    the original submit's `tec*` result (canonical ordering can flip a
 *    preliminary failure to a final success), so callers must use it
 *    instead of the original `engineResult`.
 *  - `pending` — the node knows about the tx (no lookup error) but it
 *    hasn't reached a validated ledger yet. XRPL ledgers close every ~4s,
 *    so this is the expected state for a lookup performed immediately
 *    after submit — it is NOT the same as "never landed": the tx can still
 *    validate on the next ledger close. Genuinely retryable/transient,
 *    should not be treated as a hard failure.
 *  - `not-found` — the lookup errored (including `txnNotFound`) or the
 *    queried node has no record of the tx. This does NOT prove the tx
 *    never landed (it may simply not have propagated to this node, or
 *    may still be pending elsewhere) — callers must treat it the same as
 *    `pending`, never as proof of safe-to-retry.
 */
type XrpTxLookupOutcome =
  | { status: 'validated'; transactionResult?: string }
  | { status: 'pending' }
  | { status: 'not-found' }

/**
 * Look up a submitted tx's on-ledger status by hash via the `tx` JSON-RPC
 * method. Used to disambiguate a `tec*` submit result (fee + sequence
 * consumed, applied on-ledger, op itself failed) from a preflight rejection
 * that was NEVER applied to any ledger (no fee/sequence consumed at all —
 * genuinely safe to retry) — and from a tx whose fate isn't known yet
 * (see `XrpTxLookupOutcome`).
 *
 * Never invents a `validated` result: any ambiguity (lookup error,
 * not-yet-validated) falls to `pending` or `not-found`, both of which the
 * caller must treat conservatively — never as proof the tx is safe to
 * resubmit with the same sequence.
 */
async function getXrpValidatedTxResult(
  txHash: string,
  rpcUrl: string,
  signal?: AbortSignal
): Promise<XrpTxLookupOutcome> {
  try {
    const result = await rippleCall<TxLookupResult>(rpcUrl, 'tx', { transaction: txHash }, signal)
    if (result.validated === true) {
      return { status: 'validated', transactionResult: result.meta?.TransactionResult }
    }
    return { status: 'pending' }
  } catch {
    return { status: 'not-found' }
  }
}

/**
 * Submit a signed tx blob. `tesSUCCESS` and `terQUEUED` are treated as
 * provisional-success — the caller should still poll for ledger inclusion.
 *
 * `tec*` results are verified against the ledger by hash before the final
 * outcome is decided (see the block comment above) — the thrown
 * `XrpSubmitRejectedError.reason` (or, on a canonical-ordering flip to an
 * actual success, a normal return) makes clear which of four cases applies,
 * so a caller can branch on `reason` instead of parsing the message string:
 * confirmed on-ledger failure (`'on-ledger-tec'`), not yet validated
 * (`'pending-validation'`), lookup couldn't confirm either way
 * (`'tec-lookup-unconfirmed'`), or a genuine preflight rejection that never
 * touched the ledger (`'not-on-ledger'`).
 */
export async function submitXrpTx(
  signedBlobHex: string,
  rpcUrl: string,
  signal?: AbortSignal
): Promise<XrpSubmitResult> {
  const result = await rippleCall<SubmitResult>(rpcUrl, 'submit', { tx_blob: signedBlobHex }, signal)
  const engineResult = result.engine_result ?? ''
  const engineResultMessage = result.engine_result_message ?? ''
  const txHash = result.tx_json?.hash

  if (engineResult === 'tesSUCCESS' || engineResult === 'terQUEUED') {
    return {
      engineResult,
      engineResultMessage,
      txHash,
      accepted: result.accepted ?? true,
    }
  }

  if (engineResult.startsWith('tec')) {
    // XRPL always returns tx_json.hash alongside a tec* result, but if it's
    // ever missing there's nothing to look up — treat like any other
    // unconfirmed tec* rather than claiming it's safe to retry.
    if (!txHash) {
      throw new XrpSubmitRejectedError({
        reason: 'tec-lookup-unconfirmed',
        engineResult,
        engineResultMessage,
        txHash,
      })
    }

    const outcome = await getXrpValidatedTxResult(txHash, rpcUrl, signal)
    if (outcome.status === 'validated') {
      const finalResult = outcome.transactionResult ?? engineResult
      // Canonical transaction ordering means the preliminary `tec*` result
      // from `submit` is NOT guaranteed to match the tx's actual outcome
      // once other transactions apply first in the same ledger (e.g. an
      // account that looked unfunded at submit time gets funded by an
      // earlier-ordered tx). Trust the validated `meta.TransactionResult`,
      // not the original submit response, when they disagree.
      if (!finalResult.startsWith('tec')) {
        return {
          engineResult: finalResult,
          engineResultMessage: `Validated on-ledger as ${finalResult} after a provisional ${engineResult} submit result (canonical ordering).`,
          txHash,
          accepted: true,
        }
      }
      throw new XrpSubmitRejectedError({
        reason: 'on-ledger-tec',
        engineResult: finalResult,
        engineResultMessage,
        txHash,
      })
    }
    if (outcome.status === 'pending') {
      throw new XrpSubmitRejectedError({
        reason: 'pending-validation',
        engineResult,
        engineResultMessage,
        txHash,
      })
    }

    // `not-found` — a single failed lookup right after submit doesn't
    // prove the tx never landed (see `tec-lookup-unconfirmed` above).
    throw new XrpSubmitRejectedError({
      reason: 'tec-lookup-unconfirmed',
      engineResult,
      engineResultMessage,
      txHash,
    })
  }

  // Non-tec* rejection (tem*/tel*/tef*/ter*) — XRPL's preflight rejection,
  // never applied to any ledger, no fee/sequence consumed.
  throw new XrpSubmitRejectedError({
    reason: 'not-on-ledger',
    engineResult,
    engineResultMessage,
    txHash,
  })
}
