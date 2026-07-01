/**
 * Client-side tool-output signing + parity layer (Phase 1: dual-read).
 *
 * Generalizes #922's `polymarketTxOutput.ts` into the full client-side
 * enrichment the CLI uses to sign SOME signable tool outputs off the
 * `tool-output-available` SSE channel — the same raw envelope mobile reads —
 * and to CROSS-CHECK (parity) the CLI's client-side enrichment against the
 * backend's `tx_ready` for the tools that emit both.
 *
 * ## What this module is (and is NOT) in Phase 1
 * The authoritative signing source in Phase 1 is STILL `tx_ready` whenever it
 * arrives and is signable. This module:
 *   1. Derives a client-side signable candidate from a tool's RAW output
 *      (`deriveToolOutputCandidate`) — a port of the backend transforms
 *      `enrichBuildResult` (agent-backend `agent.go:8263`) + the flat-tool
 *      approval split (peer of `splitMultiTx`, `tx_sequence.go:120`).
 *   2. Feeds that candidate into the EXISTING `onTxReady → storeServerTransaction`
 *      pipeline ONLY as (a) the sign source when NO usable `tx_ready` arrives
 *      (flat off-chain tools that emit no `tx_ready` — polymarket; and flat
 *      tools whose `tx_ready` is structurally unsignable — `build_custom_*`,
 *      whose backend `tx_ready` wraps `to_address`/`calldata` the signer can't
 *      read), or (b) the PARITY reference otherwise.
 *   3. Compares the client-enriched candidate to `tx_ready` (`diffToolOutputParity`)
 *      and the caller logs any divergence LOUDLY. This is the Phase-1 deliverable:
 *      PROVE the port against the live backend before Phase 2 removes `tx_ready`.
 *
 * ## Why NOT "prefer tool-output for signing" (design-doc literal) in Phase 1
 * `enrichBuildResult` injects `from_chain/chain/to_chain` from the TOOL-CALL
 * ARGUMENTS (`agent.go:8324`) — which the CLI never sees (it holds only tool
 * OUTPUT). A raw tool-output that omits chain would sign on the executor's
 * Ethereum default. So we FAIL CLOSED on chain here (require a self-consistent
 * `chain⇄chain_id` in the OUTPUT) and keep `tx_ready` authoritative when signable.
 * A tool-output frame for a `produces_calldata` tool is co-buffered + co-gated
 * with its `tx_ready` twin (agent.go:4838-4856 buffer, 6397-6402 flush, dropped
 * together on any block) — so preferring `tx_ready` never loses a frame, and the
 * only `tx_ready`-exclusive signal (`typed_confirm`) is not consumed by the CLI.
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
 *  - off-chain flat builders with NO `tx_ready` (polymarket) — the ONLY signing
 *    source; unchanged from #922.
 *  - `produces_calldata` flat tools that DO emit `tx_ready` (`erc20_approve`) or
 *    emit a structurally-unsignable `tx_ready` (`build_custom_*`, divergent
 *    `to_address`/`calldata`). For these, `tx_ready` stays authoritative when
 *    signable; the enriched candidate is the parity reference (and the sign
 *    source only when `tx_ready` can't sign).
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
 * Their nested `approval_tx` still uses `to`/`data`/`value`. A bounded per-tool
 * add: each new flat tool that ships new field names extends this set.
 */
export const DIVERGENT_FIELD_TOOLS: ReadonlySet<string> = new Set([
  'build_custom_credit_topup',
  'build_credit_pack_topup',
  'build_max_subscription_renewal',
  'build_pro_subscription_renewal',
])

/**
 * `execute_*` PREP tools. Their raw output is already the signer-ready
 * `{txArgs, approvalTxArgs?, stepperConfig, resolved}` envelope the executor
 * parses verbatim — no enrichment needed. In Phase 1 these are PARITY-ONLY: the
 * candidate is compared to `tx_ready` and logged, but `tx_ready` always signs
 * class E (it is present + signable for every successful `produces_calldata`
 * tool). Never becomes the sign source in practice (co-gating guarantees the
 * tool-output frame never arrives without its `tx_ready` twin).
 */
export const CLI_PARITY_PREP_TOOLS: ReadonlySet<string> = new Set([
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
 *    (must carry `txArgs`), for PARITY only.
 */
export function deriveToolOutputCandidate(toolName: string, output: unknown): ToolOutputCandidate | null {
  if (CLI_SIGNABLE_FLAT_TOOLS.has(toolName)) {
    const payload = buildTxReadyFromToolOutput(toolName, output)
    return payload ? { payload, source: 'flat', toolName } : null
  }
  if (CLI_PARITY_PREP_TOOLS.has(toolName)) {
    const env = asRecord(output)
    if (!env || env.status === 'error' || 'error' in env) return null
    const txArgs = asRecord(env.txArgs)
    if (!txArgs) return null
    // Mirror the backend phantom-card guard (enrichBuildResult, agent.go:8294-8300):
    // an execute-prep envelope whose `txArgs` lacks a `tx_encoding` discriminator is
    // structurally malformed and the backend SUPPRESSES its `tx_ready` (returns nil,
    // emitting only a live tool-output frame). Refuse to derive a candidate for it —
    // otherwise, with no `tx_ready` twin to compare against, it could become a sign
    // source. (`selectAndBufferSignable` also never signs a `source:'prep'`
    // candidate — belt-and-suspenders; prep is PARITY-ONLY.)
    if (typeof txArgs.tx_encoding !== 'string' || txArgs.tx_encoding === '') return null
    return { payload: env as TxReadyPayload, source: 'prep', toolName }
  }
  return null
}

// ============================================================================
// Parity cross-check — the Phase-1 deliverable
// ============================================================================

/** One canonical signable leg, field-name- and case-normalized so the
 *  client-enriched candidate and the backend `tx_ready` compare apples-to-apples
 *  regardless of the source field convention (`to`/`to_address`,
 *  `data`/`calldata`) or EVM/non-EVM shape. */
type CanonicalLeg = {
  to?: string
  value?: string
  data?: string
  gasLimit?: string
  chain?: string
  chainId?: string
  txEncoding?: string
  amount?: string
  memo?: string
}

/** Canonical form of a whole signable payload for parity comparison. */
export type CanonicalTx = {
  legs: CanonicalLeg[]
  /** tx_ready-exclusive fields that legitimately never ride tool-output
   *  (reported, not treated as a hard divergence). */
  exclusive: string[]
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

/** The nested tx object under any of the known keys (mirrors executor
 *  `extractNestedTx`), else the leg's own `txArgs` (non-EVM prep), else the leg. */
function nestedSource(legObj: Record<string, unknown>): Record<string, unknown> {
  const nested =
    (asRecord(legObj.tx) ||
      asRecord(legObj.swap_tx) ||
      asRecord(legObj.send_tx) ||
      asRecord((legObj.txArgs as Record<string, unknown>)?.tx)) ??
    asRecord(legObj.txArgs) ??
    legObj
  return nested
}

function canonLeg(legObj: Record<string, unknown>): CanonicalLeg {
  const src = nestedSource(legObj)
  // Chain can live at the envelope top level (flat/enriched), on `txArgs`
  // (execute_* prep) or on the nested tx — consult all so a prep-vs-tx_ready
  // chain divergence is caught (wrong-chain routing is the catastrophic case).
  const txArgs = asRecord(legObj.txArgs)
  const toRaw = str(src.to) ?? str(src.to_address)
  const dataRaw = str(src.data) ?? str(src.calldata)
  const leg: CanonicalLeg = {
    to: toRaw ? toRaw.toLowerCase() : undefined,
    value: normalizeValue(src.value),
    data: dataRaw ? dataRaw.toLowerCase() : undefined,
    gasLimit: normalizeGasLimit(src.gas_limit),
    chain: str(legObj.chain) ?? str(txArgs?.chain) ?? str(src.chain),
    chainId: str(legObj.chain_id) ?? str(txArgs?.chain_id) ?? str(src.chain_id),
    txEncoding: str(src.tx_encoding) ?? str(txArgs?.tx_encoding),
    amount: str(src.amount) ?? str(txArgs?.amount),
    memo: str(src.memo) ?? str(txArgs?.memo),
  }
  return leg
}

const TX_READY_EXCLUSIVE_KEYS = ['typed_confirm', 'sequence_id', 'sequence_index', 'sequence_total'] as const

function collectExclusive(payload: Record<string, unknown>): string[] {
  const found: string[] = []
  const scan = (obj: Record<string, unknown> | null) => {
    if (!obj) return
    for (const k of TX_READY_EXCLUSIVE_KEYS) if (k in obj && !found.includes(k)) found.push(k)
  }
  scan(payload)
  scan(asRecord(payload.tx))
  scan(asRecord(payload.txArgs))
  return found
}

/**
 * Canonicalize a signable payload (client-enriched candidate OR backend
 * `tx_ready`) into leg tuples for parity comparison. Handles single-leg
 * (`{tx}`, `{swap_tx}`, `{send_tx}`, `{txArgs.tx}`), non-EVM (`{txArgs:{to,
 * amount,memo,tx_encoding}}`), and two-leg (`{approvalTxArgs, txArgs}`) shapes.
 */
export function canonicalizeForParity(payload: unknown): CanonicalTx | null {
  const env = asRecord(payload)
  if (!env) return null
  const approval = asRecord(env.approvalTxArgs)
  const main = asRecord(env.txArgs)
  const legs: CanonicalLeg[] = approval && main ? [canonLeg(approval), canonLeg(main)] : [canonLeg(env)]
  return { legs, exclusive: collectExclusive(env) }
}

/** Result of comparing a client-enriched candidate to the backend `tx_ready`. */
export type ParityResult = {
  /** True when all safety-relevant leg fields agree across both channels. */
  match: boolean
  /** Human-readable safety-relevant divergences (empty when `match`). */
  divergences: string[]
  /** tx_ready-exclusive fields present on tx_ready but not tool-output
   *  (expected by backend design — informational, never breaks `match`). */
  txReadyExclusive: string[]
}

const HARD_FIELDS: Array<keyof CanonicalLeg> = [
  'to',
  'value',
  'data',
  'chain',
  'chainId',
  'txEncoding',
  'amount',
  'memo',
  // gas_limit is signing-relevant, NOT advisory: signEvmServerTx copies a
  // server-supplied gas_limit into the signed ethereumSpecific.gasLimit when it
  // exceeds the SDK estimate, so a gas_limit divergence means different signed
  // bytes/fee. Parity must surface it.
  'gasLimit',
]

/**
 * Compare a client-enriched tool-output candidate to the backend `tx_ready` for
 * the SAME tool call. Surfaces safety-relevant divergences (to / value / data /
 * chain / chain_id / tx_encoding / amount / memo / gas_limit, per leg, plus leg
 * count) so the caller can log them LOUDLY. This is how Phase 1 proves the
 * client-side port against the live backend before Phase 2 makes tool-output the
 * sole source. `gas_limit` counts: it changes the signed EVM gasLimit (see
 * `HARD_FIELDS`). Only tx_ready-exclusive fields (typed_confirm, sequence_id)
 * are excluded from `match`.
 */
export function diffToolOutputParity(enriched: unknown, txReady: unknown): ParityResult {
  const ce = canonicalizeForParity(enriched)
  const ct = canonicalizeForParity(txReady)
  const divergences: string[] = []
  if (!ce || !ct) {
    return {
      match: false,
      divergences: [`uncomparable payload (enriched=${ce ? 'ok' : 'null'}, tx_ready=${ct ? 'ok' : 'null'})`],
      txReadyExclusive: ct?.exclusive ?? [],
    }
  }
  if (ce.legs.length !== ct.legs.length) {
    divergences.push(`leg count: tool-output ${ce.legs.length} vs tx_ready ${ct.legs.length}`)
  }
  const n = Math.min(ce.legs.length, ct.legs.length)
  for (let i = 0; i < n; i++) {
    for (const f of HARD_FIELDS) {
      const a = ce.legs[i][f]
      const b = ct.legs[i][f]
      // Only flag when BOTH sides carry the field and they differ, or one is
      // present with a signing-relevant value the other lacks. A field absent
      // on both is not a divergence.
      if (a !== b && !(a === undefined && b === undefined)) {
        divergences.push(`leg[${i}].${f}: tool-output ${a ?? '∅'} vs tx_ready ${b ?? '∅'}`)
      }
    }
  }
  const txReadyExclusive = ct.exclusive.filter(k => !ce.exclusive.includes(k))
  // `match` ignores only the tx_ready-exclusive fields (legitimately never on
  // tool-output). Every HARD_FIELDS divergence — incl. gas_limit — fails parity.
  return { match: divergences.length === 0, divergences, txReadyExclusive }
}

// ============================================================================
// Signability probe (selection) — mirror the executor's actual requirements
// ============================================================================

/**
 * Would the executor's signer accept this payload? Mirrors the real
 * requirements (`signEvmServerTx` needs `extractNestedTx().to`;
 * `parseNonEvmEnvelope` needs `txArgs.{to,amount}`; multi-leg needs both legs).
 * Used by the session to decide whether `tx_ready` is USABLE before preferring
 * it — `storeServerTransaction` buffers some structurally-present-but-unsignable
 * payloads (e.g. `build_custom_*` `tx_ready` wrapping `to_address`/`calldata`),
 * which would only throw at sign time; this lets the session fall back to the
 * normalized tool-output candidate instead.
 */
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
