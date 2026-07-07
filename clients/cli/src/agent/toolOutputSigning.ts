/**
 * Client-side tool-output signing layer (#927 Phase 2: tool-output is the SOLE
 * sign source).
 *
 * Generalizes #922's `polymarketTxOutput.ts` into the full client-side
 * enrichment the CLI uses to sign signable tool outputs off the
 * `tool-output-available` SSE channel — the same raw envelope mobile reads.
 *
 * ## What this module does
 *   1. Derives a client-side signable candidate from a tool's RAW output
 *      (`deriveToolOutputCandidate`) — a port of the backend transforms
 *      `enrichBuildResult` (agent-backend `agent.go:8263`) + the flat-tool
 *      approval split (peer of `splitMultiTx`, `tx_sequence.go:120`).
 *   2. Hands that candidate to the session, which buffers it into the executor
 *      (`storeServerTransaction`) as the ONLY signing source.
 *
 * ## Why this is the sole source (Phase 2)
 * The production backend (agent-backend-ts) writes the signable payload on
 * `tool-output-available` and emits `data-tx_ready` only as a hollow
 * `{typed_confirm:true}` marker (no tx body) for high-distrust calldata tools —
 * a signal the CLI does not consume. Phase 1 kept the backend `tx_ready`
 * authoritative and cross-checked (parity) the client-enriched candidate against
 * it; that dual-read + parity machinery is removed here now that the port has
 * baked on main and tool-output is what production actually emits.
 *
 * ## Fail-closed chain handling
 * `enrichBuildResult` injects `from_chain/chain/to_chain` from the TOOL-CALL
 * ARGUMENTS (`agent.go:8324`) — which the CLI never sees (it holds only tool
 * OUTPUT). A raw tool-output that omits chain would sign on the executor's
 * Ethereum default. So we FAIL CLOSED on chain here (require a self-consistent
 * `chain⇄chain_id` in the OUTPUT) — a candidate that can't prove its chain is
 * never derived (→ never signed).
 *
 * ZERO agent-backend / mcp-ts change; entirely within `clients/cli`.
 */
import { getChainKind } from '@vultisig/core-chain/ChainKind'
import { Chain } from '@vultisig/sdk'

import { resolveChain, resolveChainId } from './executor'
import type { TxReadyPayload } from './types'

// ============================================================================
// Tool allowlists (name-based — the CLI holds no tools/list cache, so
// `produces_calldata` from the tool DEFINITION is unavailable at runtime;
// detection mirrors mobile's `BUILD_TX_EXACT_TOOLS` + the seed's approach).
// ============================================================================

/** Wrap USDC.e → pUSD (approve + wrap steps), flat calldata. */
export const POLYMARKET_DEPOSIT_TOOL = 'polymarket_deposit'
/** Next-missing pUSD spender approval, flat erc20_approve calldata. */
export const POLYMARKET_SETUP_TRADING_TOOL = 'polymarket_setup_trading'

/**
 * FLAT-output signable tools the CLI enriches client-side. Two kinds:
 *  - off-chain flat builders (polymarket) whose signable calldata rides
 *    tool-output; unchanged from #922.
 *  - `produces_calldata` flat tools (`erc20_approve`, `build_custom_*` — the
 *    latter with divergent `to_address`/`calldata` field names). The enriched
 *    candidate is the sign source.
 *
 * Deliberately EXCLUDED: `polymarket_place_bet` / `polymarket_setup_deposit_wallet`
 * (EIP-712, signed via `sign_typed_data`).
 */
export const CLI_SIGNABLE_FLAT_TOOLS: ReadonlySet<string> = new Set([
  POLYMARKET_DEPOSIT_TOOL,
  POLYMARKET_SETUP_TRADING_TOOL,
  'erc20_approve',
  'build_custom_credit_topup',
  'build_credit_pack_topup',
  'build_max_subscription_renewal',
  'build_pro_subscription_renewal',
])

/**
 * Flat tools whose top-level leg uses the DIVERGENT `to_address`/`calldata`
 * field names (mcp-ts payments "signing card"; `build-custom-credit-topup.ts:165`).
 * Their nested `approval_tx` still uses `to`/`data`/`value`.
 *
 * DOCUMENTATION / reference only — NOT a runtime gate. `extractLeg` tolerates
 * BOTH `to`/`to_address` and `data`/`calldata` unconditionally for every flat
 * tool, so accepting a divergent-field leg does not depend on membership here.
 * This set records WHICH tools are known to ship the divergent shape (for the
 * per-tool test fixtures and future readers); each new flat tool with new field
 * names is a bounded add to `extractLeg`'s tolerated names, mirrored here.
 */
export const DIVERGENT_FIELD_TOOLS: ReadonlySet<string> = new Set([
  'build_custom_credit_topup',
  'build_credit_pack_topup',
  'build_max_subscription_renewal',
  'build_pro_subscription_renewal',
])

/**
 * `execute_*` PREP tools. Their raw tool-output is already the signer-ready
 * `{txArgs, approvalTxArgs?, stepperConfig, resolved}` envelope the executor
 * parses verbatim — no enrichment needed. In Phase 2 these SIGN from tool-output
 * (production emits the payload there; `data-tx_ready` is a hollow marker). The
 * fail-closed gate is the `txArgs.tx_encoding` requirement in
 * `deriveToolOutputCandidate` — the mirror of the backend's phantom-card
 * suppression (`enrichBuildResult`, agent.go:8294-8300): a malformed prep
 * envelope with no `tx_encoding` yields no candidate → nothing signs.
 */
export const CLI_SIGNABLE_PREP_TOOLS: ReadonlySet<string> = new Set([
  'execute_swap',
  'execute_send',
  'execute_contract_call',
])

// ============================================================================
// Small structural helpers (carried from #922 polymarketTxOutput.ts)
// ============================================================================

/** A non-null, non-array plain object, parsing a JSON string if needed. The
 *  backend forwards an MCP tool result as the already-unmarshalled object under
 *  `output` (agent.go V1ToolOutputAvailable); we still accept a JSON string so a
 *  stringified payload is handled identically. */
export function asRecord(value: unknown): Record<string, unknown> | null {
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

/** Non-empty 0x calldata: whole bytes carrying at least a 4-byte selector.
 *  Rejects `'0x'` (empty), odd-length hex, and any value-only / no-op envelope. */
function isCalldata(value: unknown): value is string {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2}){4,}$/.test(value)
}

/** Normalise a tx `value` to a non-negative integer string the SDK can parse
 *  with `BigInt(value)`. Anything malformed defaults to `'0'` (under-sends
 *  native value at worst — the flat builders are always 0-value calls — and
 *  never throws at sign time). */
function normalizeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (/^(0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) return trimmed
  }
  return '0'
}

/** Optional server gas_limit as a non-negative integer string. A malformed /
 *  unit-suffixed value is dropped (undefined → the SDK estimates gas) rather
 *  than passed to the executor's `BigInt(gas_limit)`. */
function normalizeGasLimit(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return value.trim()
  return undefined
}

/** Minimal flat EVM tx leg lifted out of an envelope/leg object. */
type FlatLeg = { to: string; value: string; data: string; gas_limit?: string }

/**
 * Read `to`/`data` from a leg object, tolerating the divergent
 * `to_address`/`calldata` names (mcp-ts payments cards). Returns null unless
 * BOTH a real `to` (0x address) and real `data` (≥4-byte calldata) are present
 * — the guard that rejects every non-tx result (`no_op`, `insufficient_*`,
 * error envelopes) so they are NEVER signed.
 */
function extractLeg(obj: Record<string, unknown>): FlatLeg | null {
  const to = isAddress(obj.to) ? obj.to : isAddress(obj.to_address) ? (obj.to_address as string) : undefined
  const data = isCalldata(obj.data) ? obj.data : isCalldata(obj.calldata) ? (obj.calldata as string) : undefined
  if (!to || !data) return null
  const leg: FlatLeg = { to, value: normalizeValue(obj.value), data }
  const gasLimit = normalizeGasLimit(obj.gas_limit)
  if (gasLimit !== undefined) leg.gas_limit = gasLimit
  return leg
}

/**
 * Resolve + VALIDATE the envelope's EVM chain, generalized past #922's
 * Polygon-only pin. Requires `chain` and `chain_id` BOTH present in the OUTPUT
 * and resolving to the SAME supported EVM chain (the executor lets the `chain`
 * string silently win over `chain_id`, so a disagreement could route to the
 * wrong chain). Returns null (→ caller signs nothing off tool-output; `tx_ready`
 * remains authoritative) when absent/disagreeing/non-EVM. FAIL CLOSED: we never
 * inject a chain the CLI can't see (the backend injects it from tool-call args
 * the CLI doesn't hold — `agent.go:8324`).
 */
function resolveStrictEvmChain(chain: string | undefined, chainId: string | undefined): Chain | null {
  if (!chain || !chainId) return null
  const byName = resolveChain(chain)
  const byId = resolveChainId(chainId)
  if (!byName || !byId || byName !== byId) return null
  if (getChainKind(byName) !== 'evm') return null
  return byName
}

function asChainString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function asChainIdString(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/**
 * Resolve an `execute_*` prep envelope's `txArgs` chain to a KNOWN, self-consistent
 * chain, or null when it can't be trusted. This is the prep-path analogue of
 * `resolveStrictEvmChain` (#927 Phase 2 — the reviewers' converged fund-safety
 * finding): prep now signs from tool-output, so it needs the same fail-closed
 * chain guard the flat path already has. Two failure modes it closes:
 *  - NO resolvable chain (`txArgs` omits/garbles both `chain` and `chain_id`) —
 *    the executor's single-leg branch would otherwise DEFAULT to Ethereum
 *    (`resolveChainFromTxReady(...) || Chain.Ethereum`) and broadcast on the wrong
 *    chain. Fail closed instead.
 *  - DISAGREEING `chain` vs `chain_id` — the executor resolves `chain` (name)
 *    BEFORE `chain_id`, so a mismatch (e.g. chain "Base" + chain_id 1) would
 *    silently sign on the name's chain. Reject rather than pick one.
 * Unlike the flat guard this is NOT EVM-only: prep also carries non-EVM sends
 * (Cosmos/Solana), whose `chain_id` may be absent or non-numeric — so a chain that
 * resolves by NAME alone (no resolvable `chain_id`) is accepted; only a
 * present-and-disagreeing pair, or a total non-resolution, fails closed.
 */
function resolvePrepChain(txArgs: Record<string, unknown>): Chain | null {
  const byName = asChainString(txArgs.chain) ? resolveChain(asChainString(txArgs.chain)!) : null
  const byId = asChainIdString(txArgs.chain_id) ? resolveChainId(asChainIdString(txArgs.chain_id)!) : null
  if (!byName && !byId) return null
  if (byName && byId && byName !== byId) return null
  return byName ?? byId
}

// ============================================================================
// Flat-tool enrichment (the port) — enrichBuildResult + flat approval split
// ============================================================================

/**
 * Turn a FLAT signable tool's output envelope into a `tx_ready`-shaped payload
 * the executor can sign, or `null` when the output carries no signable
 * transaction / fails a guard (caller signs nothing off tool-output).
 *
 * Port of `enrichBuildResult` (`agent.go:8263`) flat→nested `{tx:…}` wrap +
 * chain copy, PLUS the flat-level approval split (peer of `splitMultiTx`
 * Pattern 1, `tx_sequence.go:120`) mapped onto the executor's existing two-leg
 * `{approvalTxArgs, txArgs}` machinery. Divergent `to_address`/`calldata` fields
 * are normalized in `extractLeg`.
 *
 * Returns null when: not a flat signable tool; output isn't an object; error /
 * `status:error` envelope; no valid flat tx (`no_op` / `insufficient_*` /
 * missing to/data); `needs_approval` without a usable `approval_tx` (fail
 * closed — never sign the main leg against a stale allowance); chain / chain_id
 * missing / disagreeing / non-EVM.
 */
export function buildTxReadyFromToolOutput(toolName: string, output: unknown): TxReadyPayload | null {
  if (!CLI_SIGNABLE_FLAT_TOOLS.has(toolName)) return null

  const env = asRecord(output)
  if (!env) return null

  // Never route an error/no-op envelope into the signer.
  if (env.status === 'error' || 'error' in env) return null

  const chain = asChainString(env.chain)
  const chainId = asChainIdString(env.chain_id)
  // Require a known, self-consistent EVM chain (generalized past Polygon).
  if (!resolveStrictEvmChain(chain, chainId)) return null
  // `chain`/`chainId` are non-undefined here (resolveStrictEvmChain guards).
  const chainStr = chain as string
  const chainIdStr = chainId as string

  // Passed through for the human-readable confirm summary only (inert to signing).
  const action = typeof env.action === 'string' && env.action !== '' ? env.action : undefined

  const main = extractLeg(env)
  if (!main) return null

  // Bundled approve+main (deposit wrap while allowance is still insufficient,
  // or a payments card with a required approve). Map onto the executor's
  // EXISTING two-leg machinery so the approve is signed+confirmed (receipt-wait)
  // BEFORE the main tx. `needs_approval` truthy (not strict `=== true`) with a
  // missing/invalid `approval_tx` FAILS CLOSED (null) — signing the main leg
  // alone against a stale allowance is the funds-regression this path avoids.
  if (env.needs_approval) {
    const approval = asRecord(env.approval_tx)
    // Re-apply the error gate to the nested approve leg (defense in depth).
    if (!approval || approval.status === 'error' || 'error' in approval) return null
    const approveLeg = extractLeg(approval)
    if (!approveLeg) return null
    return {
      __buildTx: true,
      chain: chainStr,
      chain_id: chainIdStr,
      ...(action ? { action } : {}),
      approvalTxArgs: { chain: chainStr, chain_id: chainIdStr, tx: approveLeg },
      txArgs: { chain: chainStr, chain_id: chainIdStr, tx: main },
    }
  }

  return { __buildTx: true, chain: chainStr, chain_id: chainIdStr, ...(action ? { action } : {}), tx: main }
}

/** Marker: the candidate came from a flat enrichment (`build*`/polymarket/…) vs
 *  an `execute_*` prep passthrough. Drives selection logging only. */
export type ToolOutputCandidate = {
  payload: TxReadyPayload
  source: 'flat' | 'prep'
  toolName: string
}

/**
 * Derive a client-side signable candidate from a signable tool's raw output, or
 * null when the tool is not signable / the output carries no signable tx.
 *  - FLAT tools → `buildTxReadyFromToolOutput` (the port).
 *  - `execute_*` PREP tools → passthrough of the already-signer-ready envelope
 *    (must carry `txArgs` with a `tx_encoding` discriminator).
 */
export function deriveToolOutputCandidate(toolName: string, output: unknown): ToolOutputCandidate | null {
  if (CLI_SIGNABLE_FLAT_TOOLS.has(toolName)) {
    const payload = buildTxReadyFromToolOutput(toolName, output)
    return payload ? { payload, source: 'flat', toolName } : null
  }
  if (CLI_SIGNABLE_PREP_TOOLS.has(toolName)) {
    const env = asRecord(output)
    if (!env || env.status === 'error' || 'error' in env) return null
    const txArgs = asRecord(env.txArgs)
    if (!txArgs) return null
    // Mirror the backend phantom-card guard (enrichBuildResult, agent.go:8294-8300):
    // an execute-prep envelope whose `txArgs` lacks a `tx_encoding` discriminator is
    // structurally malformed and the backend SUPPRESSES its card. Refuse to derive a
    // candidate for it — this is the load-bearing fail-closed gate for prep signing
    // (a phantom card yields no candidate → nothing signs).
    if (typeof txArgs.tx_encoding !== 'string' || txArgs.tx_encoding === '') return null
    // Fail-closed chain guard (parity with the flat path's resolveStrictEvmChain):
    // reject a prep envelope with no resolvable chain (would default to Ethereum at
    // sign time) or a disagreeing chain⇄chain_id (would silently sign on the name's
    // chain). For a multi-leg envelope `env.txArgs` is the MAIN leg; the executor
    // separately enforces approval⇄main⇄parent chain agreement.
    if (!resolvePrepChain(txArgs)) return null
    return { payload: env as TxReadyPayload, source: 'prep', toolName }
  }
  return null
}

// ============================================================================
// Signability probe (selection) — mirror the executor's actual requirements
// ============================================================================

/**
 * Would the executor's signer accept this payload? Mirrors the real
 * requirements (`signEvmServerTx` needs `extractNestedTx().to`;
 * `parseNonEvmEnvelope` needs `txArgs.{to,amount}`; multi-leg needs both legs).
 * The session's sign gate (`selectAndBufferSignable`) uses this as the
 * fail-closed structural check before buffering a tool-output candidate — a
 * structurally-present-but-unsignable payload (e.g. a `build_custom_*` shape the
 * enricher couldn't normalize) is never routed to the signer.
 */
/** A non-empty string, or a finite number stringified; else undefined. */
function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

export function payloadLooksSignable(payload: unknown): boolean {
  const env = asRecord(payload)
  if (!env) return false
  const approval = asRecord(env.approvalTxArgs)
  const main = asRecord(env.txArgs)
  if (approval && main) {
    if (!legSignable(approval) || !legSignable(main)) return false
    // Mirror storeServerTransaction's multi-leg guard: both legs must resolve to
    // the SAME chain (it rejects a cross-chain 2-leg envelope). If they disagree,
    // the executor would reject at store time, so it does not "look signable" here.
    const aChain = str(approval.chain)
    const mChain = str(main.chain)
    if (aChain && mChain && aChain !== mChain) return false
    return true
  }
  return legSignable(env)
}

function legSignable(legObj: Record<string, unknown>): boolean {
  // EVM: a nested tx with a real `to` address.
  const nested =
    asRecord(legObj.tx) ||
    asRecord(legObj.swap_tx) ||
    asRecord(legObj.send_tx) ||
    asRecord((legObj.txArgs as Record<string, unknown>)?.tx)
  if (nested && isAddress(nested.to)) return true
  // Non-EVM: txArgs carries to + amount directly.
  const txArgs = asRecord(legObj.txArgs)
  if (txArgs && typeof txArgs.to === 'string' && typeof txArgs.amount === 'string') return true
  return false
}
