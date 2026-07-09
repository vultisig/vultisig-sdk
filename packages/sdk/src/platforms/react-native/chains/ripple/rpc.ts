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
// what to throw: a `tx` JSON-RPC lookup by hash distinguishes three
// outcomes (see `XrpSubmitRejectionReason` / `XrpTxLookupOutcome`) —
// confirmed-validated (definitive fee/sequence-consumed failure),
// not-yet-validated (transient, ledgers close ~4s, not a hard failure),
// and not-found (fund-safe default, treated like any other rejection).
// Verification only sharpens the thrown error; it is never a path to
// reporting false success.
// ---------------------------------------------------------------------------

export type XrpSubmitResult = {
  engineResult: string
  engineResultMessage: string
  txHash: string | undefined
  accepted: boolean
}

/**
 * Why a submit-rejection is fund-relevant or not:
 *  - `on-ledger-tec` — the `tec*` result was confirmed against the ledger
 *    by hash: the tx WAS included in a validated ledger (fee + sequence
 *    consumed), the requested operation itself failed. Retrying with the
 *    same `Sequence` will fail (`tefPAST_SEQ`) or worse race a fee change.
 *  - `pending-validation` — a `tec*` result whose tx was found by hash but
 *    hasn't reached a validated ledger yet (expected right after submit —
 *    ledgers close every ~4s). Transient: NOT proof the tx landed, NOT
 *    proof it didn't. The caller should re-check by hash rather than
 *    either assume success or blindly resubmit with the same sequence.
 *  - `not-on-ledger` — every other rejection (`tem*`/`tel*`/`tef*`/`ter*`,
 *    or a `tec*` result whose hash lookup came back not-found). The tx
 *    never landed; safe to retry with the same sequence.
 */
export type XrpSubmitRejectionReason = 'on-ledger-tec' | 'pending-validation' | 'not-on-ledger'

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
    const message =
      reason === 'on-ledger-tec'
        ? `XRP submit applied on-ledger with a failed result (fee + sequence consumed, transfer NOT completed): ` +
          `${engineResult} — ${engineResultMessage}. txHash=${txHash}. Do not retry with the same sequence.`
        : reason === 'pending-validation'
          ? `XRP submit returned ${engineResult} — ${engineResultMessage}. txHash=${txHash} was found but has not ` +
            `reached a validated ledger yet. This is not a definitive failure — re-check by hash before deciding ` +
            `whether to resubmit with the same sequence.`
          : `XRP submit rejected: ${engineResult || 'unknown'} — ${engineResultMessage}`
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
 *  - `validated` — the ledger confirms the tx applied (`tec*` is definitive:
 *    fee + sequence consumed, transfer failed).
 *  - `pending` — the node knows about the tx (no lookup error) but it
 *    hasn't reached a validated ledger yet. XRPL ledgers close every ~4s,
 *    so this is the expected state for a lookup performed immediately
 *    after submit — it is NOT the same as "never landed": the tx can still
 *    validate on the next ledger close. Genuinely retryable/transient,
 *    should not be treated as a hard failure.
 *  - `not-found` — the lookup errored (including `txnNotFound`) or the
 *    node has no record of the tx at all. Fund-safe default: treated the
 *    same as any other non-`tec*` rejection (never landed).
 */
type XrpTxLookupOutcome =
  | { status: 'validated'; transactionResult?: string }
  | { status: 'pending' }
  | { status: 'not-found' }

/**
 * Look up a submitted tx's on-ledger status by hash via the `tx` JSON-RPC
 * method. Used to disambiguate a `tec*` submit result (fee + sequence
 * consumed, applied on-ledger, op itself failed) from a tx that was NEVER
 * included in a validated ledger (network hiccup / expired
 * `LastLedgerSequence` / server-local rejection) — the latter is fund-safe
 * to retry with the same sequence, the former is NOT — and from a tx that
 * simply hasn't validated *yet* (see `XrpTxLookupOutcome`).
 *
 * Never invents a `validated` result: any ambiguity (lookup error,
 * not-yet-validated) falls to `pending` or `not-found`, both of which the
 * caller treats conservatively.
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
 * error is thrown (see the block comment above) — the thrown
 * `XrpSubmitRejectedError.reason` makes clear whether the tx actually
 * consumed the fee/sequence on-ledger (`'on-ledger-tec'`), hasn't reached a
 * validated ledger yet (`'pending-validation'`), or never landed
 * (`'not-on-ledger'`), so a caller can branch on `reason` instead of
 * parsing the message string. Every other non-success engine result
 * throws directly with `reason: 'not-on-ledger'`.
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

  if (engineResult.startsWith('tec') && txHash) {
    const outcome = await getXrpValidatedTxResult(txHash, rpcUrl, signal)
    if (outcome.status === 'validated') {
      throw new XrpSubmitRejectedError({
        reason: 'on-ledger-tec',
        engineResult: outcome.transactionResult ?? engineResult,
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
  }

  throw new XrpSubmitRejectedError({
    reason: 'not-on-ledger',
    engineResult,
    engineResultMessage,
    txHash,
  })
}
