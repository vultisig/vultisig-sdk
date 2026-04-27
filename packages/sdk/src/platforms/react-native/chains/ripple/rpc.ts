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
    throw new Error(`XRP RPC HTTP ${res.status} ${res.statusText} from ${rpcUrl}`)
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

/**
 * Submit a signed tx blob. `tesSUCCESS` and `terQUEUED` are treated as
 * provisional-success — the caller should still poll for ledger inclusion.
 * Anything else throws.
 */
export async function submitXrpTx(
  signedBlobHex: string,
  rpcUrl: string,
  signal?: AbortSignal
): Promise<XrpSubmitResult> {
  const result = await rippleCall<SubmitResult>(rpcUrl, 'submit', { tx_blob: signedBlobHex }, signal)
  const engineResult = result.engine_result ?? ''
  const engineResultMessage = result.engine_result_message ?? ''
  if (engineResult !== 'tesSUCCESS' && engineResult !== 'terQUEUED') {
    throw new Error(`XRP submit rejected: ${engineResult || 'unknown'} — ${engineResultMessage}`)
  }
  return {
    engineResult,
    engineResultMessage,
    txHash: result.tx_json?.hash,
    accepted: result.accepted ?? true,
  }
}
