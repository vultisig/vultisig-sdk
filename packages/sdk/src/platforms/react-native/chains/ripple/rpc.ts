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
// `submitXrpTx` verifies on-ledger state for `tec*` results before deciding:
// a `tx` JSON-RPC lookup by hash confirms whether the transaction actually
// validated on-ledger. If it did, the error message says so explicitly and
// warns against retrying with the same sequence. If the lookup can't
// confirm inclusion (not found / transport hiccup), the original `tec*`
// error is surfaced unchanged — verification is a safety net for a clearer
// error message, never a path to reporting false success.
// ---------------------------------------------------------------------------

export type XrpSubmitResult = {
  engineResult: string
  engineResultMessage: string
  txHash: string | undefined
  accepted: boolean
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
 * Look up a submitted tx's on-ledger status by hash via the `tx` JSON-RPC
 * method. Used to disambiguate a `tec*` submit result (fee + sequence
 * consumed, applied on-ledger, op itself failed) from a tx that was NEVER
 * included in a validated ledger (network hiccup / expired
 * `LastLedgerSequence` / server-local rejection) — the latter is fund-safe
 * to retry with the same sequence, the former is NOT.
 *
 * Falls through to `validated: false` on any lookup error (including
 * `txnNotFound`) — the caller keeps the original `tec*` error in that case,
 * which is the fund-safe default (verification unavailable, never invented).
 */
async function getXrpValidatedTxResult(
  txHash: string,
  rpcUrl: string,
  signal?: AbortSignal
): Promise<{ validated: boolean; transactionResult?: string }> {
  try {
    const result = await rippleCall<TxLookupResult>(rpcUrl, 'tx', { transaction: txHash }, signal)
    return { validated: result.validated === true, transactionResult: result.meta?.TransactionResult }
  } catch {
    return { validated: false }
  }
}

/**
 * Submit a signed tx blob. `tesSUCCESS` and `terQUEUED` are treated as
 * provisional-success — the caller should still poll for ledger inclusion.
 *
 * `tec*` results are verified against the ledger by hash before the final
 * error is thrown (see the block comment above) — the thrown error text
 * makes clear whether the tx actually consumed the fee/sequence on-ledger,
 * so a caller never mistakes a real on-ledger `tec*` failure for a tx that
 * never landed. Every other non-success engine result throws directly.
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
    const { validated, transactionResult } = await getXrpValidatedTxResult(txHash, rpcUrl, signal)
    if (validated) {
      throw new Error(
        `XRP submit applied on-ledger with a failed result (fee + sequence consumed, transfer NOT completed): ` +
          `${transactionResult ?? engineResult} — ${engineResultMessage}. txHash=${txHash}. ` +
          `Do not retry with the same sequence.`
      )
    }
  }

  throw new Error(`XRP submit rejected: ${engineResult || 'unknown'} — ${engineResultMessage}`)
}
