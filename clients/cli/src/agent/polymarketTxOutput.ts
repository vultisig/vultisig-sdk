/**
 * Polymarket flat-tx-builder output → signable `tx_ready` bridge (Design B).
 *
 * The headless CLI signs Polymarket flat-tx-builder tool outputs the SAME way
 * the mobile app does. Mobile reads the flat transaction envelope an allowlisted
 * tool emits and routes it through its `BUILD_TX_EXACT_TOOLS` sign path; this
 * module is the CLI's peer: it reads the flat envelope off the
 * `tool-output-available` SSE channel and feeds it into the EXISTING
 * `onTxReady → storeServerTransaction → signTxFromBuffer` pipeline unchanged.
 * The only intended difference from mobile is that the CLI auto-signs (under
 * `--yes` / a cached password) instead of asking for a device tap.
 *
 * Why this is necessary (and safe):
 *  - These tools deliberately do NOT set `producesCalldata` (kept OFF per the
 *    mcp-ts m7 contract), so the backend emits NO `tx_ready` frame for them.
 *    The flat `{chain, chain_id, to, value, data}` envelope is nonetheless
 *    already on the wire, untouched, in the tool output (the safety seams are
 *    flag-gated off, so nothing mutates it). This module is the only consumer
 *    that turns that output into a signable tx — ZERO agent-backend / mcp-ts
 *    change, ZERO mobile/scheduler blast radius.
 *  - They are pure calldata builders (no server-side action on call), so signing
 *    their output is correct — the same contract mobile relies on.
 *
 * The `extractNestedTx` helper the executor uses recognises a tx under
 * `swap_tx | send_tx | tx | txArgs.tx` — NOT a bare top-level `{to,value,data}`.
 * So a single flat envelope is wrapped as `{chain, chain_id, tx:{…}}`, and the
 * bundled approve+wrap deposit envelope is mapped onto the executor's existing
 * two-leg machinery (`approvalTxArgs` + `txArgs`, each carrying a nested `tx`),
 * which signs approve→wrap with a receipt-wait between legs.
 */
import type { TxReadyPayload } from './types'

/** Wrap USDC.e → pUSD (approve + wrap steps), flat calldata. */
export const POLYMARKET_DEPOSIT_TOOL = 'polymarket_deposit'
/** Next-missing pUSD spender approval, flat erc20_approve calldata. */
export const POLYMARKET_SETUP_TRADING_TOOL = 'polymarket_setup_trading'

/**
 * Allowlist of FLAT-calldata Polymarket builder tools the CLI signs from the
 * `tool-output-available` channel. Mirrors mobile's `BUILD_TX_EXACT_TOOLS`
 * (flat-calldata subset). The parity test
 * (`polymarketTxOutput.parity.test.ts`) pins the documented relationship to the
 * mcp-ts m7 `OFF_CHAIN_SIGNABLE_TOOL_NAMES` so the two can't silently drift.
 *
 * Deliberately EXCLUDED:
 *  - `polymarket_place_bet` — produces EIP-712 payloads (off-chain signatures),
 *    NOT flat calldata; signed via a different path. (It IS in the mcp-ts m7
 *    list, which enumerates off-chain-signable tools, not flat-calldata tools.)
 *  - `polymarket_setup_deposit_wallet` — its signable output is an EIP-712 Batch
 *    (typed data), signed via the existing `sign_typed_data` path.
 */
export const CLI_BUILD_TX_TOOL_NAMES: ReadonlySet<string> = new Set([
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
])

/**
 * Chains the Polymarket flat-tx builders target. Polymarket is Polygon-only, so
 * this pins the exact `(chain name ⇄ chain_id)` pair the envelope must carry. A
 * malformed/unexpected envelope (wrong or disagreeing chain fields) is rejected
 * up front so signing can NEVER be routed to the wrong EVM chain — the executor
 * resolves chain from the envelope and `chain` (a string) silently wins over
 * `chain_id` (executor.ts resolveChainFromTxReady / signEvmServerTx), so the
 * bridge validates both agree before handing anything to the signer. Extend this
 * map (and the guard test) if a builder ever legitimately targets a new chain.
 */
const POLYMARKET_EVM_CHAINS: ReadonlyMap<string, string> = new Map([['Polygon', '137']])

/** Minimal flat EVM tx leg lifted out of a builder envelope. */
type FlatLeg = { to: string; value: string; data: string; gas_limit?: string }

/** A non-null, non-array plain object, parsing a JSON string if needed. The
 *  backend forwards an MCP tool result as the already-unmarshalled object under
 *  `output` (agent.go V1ToolOutputAvailable); we still accept a JSON string so a
 *  stringified payload is handled identically. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

/** A 0x-prefixed 20-byte EVM address. */
function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
}

/** Non-empty 0x calldata carrying at least a 4-byte selector. Rejects `'0x'`
 *  (empty) so a value-only / no-op envelope can never be mistaken for a call. */
function isCalldata(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{8,}$/.test(value)
}

/** Normalise a tx `value` to a non-negative integer string the SDK can parse
 *  with `BigInt(value)`. Anything malformed (negative, decimal, non-numeric)
 *  defaults to `'0'`: the builder tools are always 0-value approve/wrap calls,
 *  and defaulting low can only ever UNDER-send native value, never over-send,
 *  while also avoiding a `BigInt()` parse throw at sign time. */
function normalizeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^(0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) return trimmed
  }
  return '0'
}

/** Optional server gas_limit, as a string, when present and usable. */
function normalizeGasLimit(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim() !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Lift a flat tx leg out of an envelope/leg object. Returns null unless BOTH a
 * real `to` (0x address) and real `data` (≥4-byte calldata) are present — this
 * is the guard that rejects every non-tx result (`{action:'no_op'}`,
 * `{action:'insufficient_usdce'}`, error envelopes) so they are NEVER signed.
 */
function extractLeg(obj: Record<string, unknown>): FlatLeg | null {
  if (!isAddress(obj.to) || !isCalldata(obj.data)) return null
  const leg: FlatLeg = { to: obj.to, value: normalizeValue(obj.value), data: obj.data }
  const gasLimit = normalizeGasLimit(obj.gas_limit)
  if (gasLimit !== undefined) leg.gas_limit = gasLimit
  return leg
}

/**
 * Turn an allowlisted Polymarket tool's flat output envelope into a
 * `tx_ready`-shaped payload the executor can sign, or `null` when the output
 * carries no signable transaction (so the caller signs nothing).
 *
 * Returns null when:
 *  - `toolName` is not in {@link CLI_BUILD_TX_TOOL_NAMES};
 *  - the output is not a JSON object;
 *  - the output is an error / status:error envelope;
 *  - the output has no valid flat tx (`no_op` / `insufficient_usdce` / missing
 *    `to`/`data`);
 *  - the output claims `needs_approval` but carries no usable `approval_tx`
 *    (fail closed: never sign the wrap leg alone against a stale allowance —
 *    that is the funds-regression the bundled approve→wrap path exists to avoid).
 *  - the envelope's `chain` / `chain_id` are missing or disagree, or name a
 *    chain outside {@link POLYMARKET_EVM_CHAINS} (so signing can never be routed
 *    to the wrong / a non-EVM chain).
 */
export function buildTxReadyFromToolOutput(toolName: string, output: unknown): TxReadyPayload | null {
  if (!CLI_BUILD_TX_TOOL_NAMES.has(toolName)) return null

  const env = asRecord(output)
  if (!env) return null

  // Never route an error/no-op envelope into the signer.
  if (env.status === 'error' || 'error' in env) return null

  const chain = typeof env.chain === 'string' && env.chain !== '' ? env.chain : undefined
  const chainId =
    typeof env.chain_id === 'string' && env.chain_id !== ''
      ? env.chain_id
      : typeof env.chain_id === 'number' && Number.isFinite(env.chain_id)
        ? String(env.chain_id)
        : undefined
  // Require a known, self-consistent chain. mcp-ts always emits chain:'Polygon'
  // + chain_id:'137'; reject anything where they're absent or disagree so a
  // malformed envelope can't sign on the wrong chain (executor lets the `chain`
  // string silently win over `chain_id`).
  if (!chain || !chainId || POLYMARKET_EVM_CHAINS.get(chain) !== chainId) return null

  // Passed through for the human-readable confirm-gate summary only (inert to
  // the executor's signing path); e.g. 'approve' / 'wrap_usdce_to_pusd'.
  const action = typeof env.action === 'string' && env.action !== '' ? env.action : undefined

  const main = extractLeg(env)
  if (!main) return null

  // Bundled approve+wrap (deposit wrap step while USDC.e allowance is still
  // insufficient): map onto the executor's EXISTING two-leg machinery so the
  // approve is signed+confirmed (receipt-wait) BEFORE the wrap, never shipped as
  // a single tx. `needs_approval` with a missing/invalid `approval_tx` fails
  // closed (return null) — signing only the wrap would revert / regress funds.
  if (env.needs_approval === true) {
    const approval = asRecord(env.approval_tx)
    const approveLeg = approval ? extractLeg(approval) : null
    if (!approveLeg) return null
    return {
      __buildTx: true,
      chain,
      chain_id: chainId,
      ...(action ? { action } : {}),
      approvalTxArgs: { chain, chain_id: chainId, tx: approveLeg },
      txArgs: { chain, chain_id: chainId, tx: main },
    }
  }

  return { __buildTx: true, chain, chain_id: chainId, ...(action ? { action } : {}), tx: main }
}
