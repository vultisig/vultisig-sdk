/**
 * Tool-output → signable-candidate derivation (#1676).
 *
 * Pure, vault-free complement of `normalize.ts` (which stops at normalize/split).
 * This module owns the fail-closed contract that decides whether a raw tool
 * output is signable and, if so, what envelope the signer should consume.
 *
 * Hoisted from `clients/cli/src/agent/toolOutputSigning.ts` with behavior
 * preserved exactly. CLI re-exports this module so existing import paths stay
 * stable. `CLI_*` allowlist names are kept on purpose — they are the public
 * contract the CLI + characterization tests already pin.
 *
 * ## Fail-closed chain handling
 * A raw tool-output that omits chain would otherwise sign on an Ethereum
 * default. We require a self-consistent `chain⇄chain_id` in the OUTPUT — a
 * candidate that can't prove its chain is never derived (→ never signed).
 */
import { Chain } from '@vultisig/core-chain/Chain'
import { getChainKind } from '@vultisig/core-chain/ChainKind'

import { resolveChainReference } from '../utils/resolveChainReference'

function resolveChain(name: string): Chain | null {
  return resolveChainReference(name) ?? null
}

function resolveChainId(chainId: string | number): Chain | null {
  return resolveChainReference(chainId) ?? null
}

/**
 * Signable envelope derived from raw tool output. Structural superset of the
 * CLI `TxReadyPayload` SSE type (`__buildTx`, `approvalTxArgs`, `txArgs`).
 */
export type SignableTxCandidatePayload = {
  sequence?: number
  chain?: string
  chain_id?: string
  action?: string
  signing_mode?: string
  unsigned_tx_hex?: string
  tx_details?: Record<string, unknown>
  keysign_payload?: string
  swap_tx?: Record<string, unknown>
  send_tx?: Record<string, unknown>
  tx?: Record<string, unknown>
  approvalTxArgs?: Record<string, unknown>
  txArgs?: Record<string, unknown>
  __buildTx?: boolean
  [key: string]: unknown
}

/** @deprecated Use {@link SignableTxCandidatePayload}. Kept so CLI re-exports stay name-stable. */
export type TxReadyPayload = SignableTxCandidatePayload

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

/**
 * `yield_enter` / `yield_exit` (yield.xyz deposit/withdraw). Their output is a
 * THIRD shape, distinct from both flat and prep tools: a top-level
 * `transactions[]` array of already-built flat EVM legs
 * (`{to, value, data, action, description}`) — the `splitMultiTx` Pattern 2 /
 * `build_cctp_bridge_usdc` envelope (mcp-lunc-hop `yield-tools.ts:435-457`).
 * A well-formed EVM deposit is a 2-step approve→deposit sequence; some actions
 * (a pure withdraw, or a deposit whose allowance is already sufficient) are a
 * single step.
 *
 * Neither existing derivation covers this: the FLAT path reads a single flat
 * leg off the envelope root (`extractLeg(env)`) and never walks `transactions[]`;
 * the PREP path requires `txArgs.tx_encoding`, which yield's EVM envelope
 * deliberately omits (yield-tools.ts:205-210). So `yield_enter`/`yield_exit`
 * fell through `deriveToolOutputCandidate` → no candidate → the CLI never
 * synthesized a `sign_tx` → keysign never fired (bead vultisig-6rg2, found via
 * live real-fund dogfood: the turn ended at the backend's "Transaction prepared"
 * with no txHash).
 *
 * `deriveYieldCandidate` maps the `transactions[]` legs onto the executor's
 * EXISTING two-leg (`{approvalTxArgs, txArgs}`) / single-leg (`{tx}`) machinery,
 * reusing `extractLeg` (faithful to/value/data lift — never fabricates calldata)
 * and `resolveStrictEvmChain` (fail-closed EVM chain guard). EVM-only, matching
 * both the executor's `signMultiLeg` EVM-only constraint AND yield's EVM
 * canonical-envelope path; non-EVM yields (Solana/Sui/Ton/Tron prebuilt) carry
 * a per-step `tx_encoding` and are left for a follow-up.
 */
export const CLI_SIGNABLE_YIELD_TOOLS: ReadonlySet<string> = new Set(['yield_enter', 'yield_exit'])

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

/**
 * Resolve the parent chain metadata on an execute_* prep envelope the same way the
 * executor does for single-leg payloads: `chain` → `from_chain` → `chain_id`.
 * Returns null when present metadata is unresolved or self-conflicting.
 */
function resolvePrepParentChain(env: Record<string, unknown>): Chain | null {
  const byChain = asChainString(env.chain) ? resolveChain(asChainString(env.chain)!) : null
  const byFromChain = asChainString(env.from_chain) ? resolveChain(asChainString(env.from_chain)!) : null
  const byId = asChainIdString(env.chain_id) ? resolveChainId(asChainIdString(env.chain_id)!) : null
  const candidates = [byChain, byFromChain, byId].filter((c): c is Chain => c !== null)
  if (candidates.length === 0) return null
  if (candidates.some(c => c !== candidates[0])) return null
  return candidates[0]
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

/**
 * Turn a `yield_enter`/`yield_exit` output into a signable candidate, or null
 * when it carries no signable EVM transaction / fails a guard.
 *
 * The yield EVM envelope is `{ chain, provider:'yield_xyz', transactions:[…] }`
 * where each `transactions[]` entry is a flat leg `{to, value, data, action,
 * description}` (yield-tools.ts:435-457). We:
 *   - require a known, self-consistent EVM chain via the same fail-closed guard
 *     the flat path uses. yield emits a top-level `chain` (PascalCase) but no
 *     `chain_id`, so we resolve `chain` alone (strict name→EVM) rather than
 *     demanding the chain⇄chain_id pair `resolveStrictEvmChain` wants;
 *   - lift EACH leg through `extractLeg` (the SAME faithful to/value/data reader
 *     the flat/polymarket path uses — it copies the backend-built calldata
 *     verbatim and NEVER fabricates or mutates it), rejecting any leg that isn't
 *     a real tx (missing to/data);
 *   - map a 2-leg approve→action sequence onto the executor's `{approvalTxArgs,
 *     txArgs}` two-leg machinery (approve is signed + receipt-confirmed BEFORE
 *     the action leg — same sequencing swap-with-approval uses), and a 1-leg
 *     action onto the single-leg `{tx}` shape.
 *
 * Returns null (→ nothing signs) when: not a yield tool; error/no-op envelope;
 * chain missing / non-EVM; `transactions[]` absent/empty; ANY leg fails
 * `extractLeg`; more than 2 legs (yield.xyz EVM actions are approve+action; a
 * >2-leg envelope is unexpected and we refuse rather than sign a shape the
 * executor's 2-leg sequencer can't represent — fail closed, leave it beaded).
 *
 * The scan_request the yield tool emits (`env.scan_request`) is inert to signing
 * and is NOT consumed here — L4/the backend runs the Blockaid scan before the
 * tool output reaches the CLI; this path does not bypass it.
 */
export function buildTxReadyFromYieldOutput(toolName: string, output: unknown): TxReadyPayload | null {
  if (!CLI_SIGNABLE_YIELD_TOOLS.has(toolName)) return null

  const env = asRecord(output)
  if (!env) return null
  if (env.status === 'error' || 'error' in env) return null

  // yield emits a top-level PascalCase `chain` (Ethereum, Polygon, …) and no
  // `chain_id`. Resolve strictly by name and require EVM (the executor's
  // multi-leg sequencer + yield's canonical multi-step envelope are EVM-only).
  const chain = asChainString(env.chain)
  if (!chain) return null
  const resolved = resolveChain(chain)
  if (!resolved || getChainKind(resolved) !== 'evm') return null
  const chainStr = chain

  const rawTxs = env.transactions
  if (!Array.isArray(rawTxs) || rawTxs.length === 0) return null

  // Lift every leg faithfully. A single un-liftable leg fails the whole action
  // closed — never sign a partial sequence (mirrors yield-tools' all-or-nothing
  // canonicalization: an approve that signs while its deposit is dropped would
  // leave funds approved-but-not-deposited).
  const legs: FlatLeg[] = []
  for (const raw of rawTxs) {
    const legObj = asRecord(raw)
    if (!legObj) return null
    if (legObj.status === 'error' || 'error' in legObj) return null
    const leg = extractLeg(legObj)
    if (!leg) return null
    legs.push(leg)
  }

  // The executor's two-leg sequencer represents exactly approve→main. yield.xyz
  // EVM actions are 1 leg (action only) or 2 legs (approve + action). Refuse a
  // >2-leg envelope rather than silently drop legs.
  if (legs.length > 2) return null

  const action = typeof env.action === 'string' && env.action !== '' ? env.action : undefined

  if (legs.length === 2) {
    const [approveLeg, mainLeg] = legs
    return {
      __buildTx: true,
      chain: chainStr,
      ...(action ? { action } : {}),
      approvalTxArgs: { chain: chainStr, tx: approveLeg },
      txArgs: { chain: chainStr, tx: mainLeg },
    }
  }

  return { __buildTx: true, chain: chainStr, ...(action ? { action } : {}), tx: legs[0] }
}

/** Marker: the candidate came from a flat enrichment (`build*`/polymarket/…), an
 *  `execute_*` prep passthrough, or a `yield_*` multi-step envelope. Drives
 *  selection logging only. */
export type ToolOutputCandidate = {
  payload: TxReadyPayload
  source: 'flat' | 'prep' | 'yield'
  toolName: string
}

/**
 * Derive a client-side signable candidate from a signable tool's raw output, or
 * null when the tool is not signable / the output carries no signable tx.
 *  - FLAT tools → `buildTxReadyFromToolOutput` (the port).
 *  - `execute_*` PREP tools → passthrough of the already-signer-ready envelope
 *    (must carry `txArgs` with a `tx_encoding` discriminator).
 *  - `yield_enter`/`yield_exit` → `buildTxReadyFromYieldOutput` maps the
 *    top-level `transactions[]` (approve + action) EVM legs onto the executor's
 *    two-leg / single-leg machinery (bead vultisig-6rg2).
 */
export function deriveToolOutputCandidate(toolName: string, output: unknown): ToolOutputCandidate | null {
  if (CLI_SIGNABLE_FLAT_TOOLS.has(toolName)) {
    const payload = buildTxReadyFromToolOutput(toolName, output)
    return payload ? { payload, source: 'flat', toolName } : null
  }
  if (CLI_SIGNABLE_YIELD_TOOLS.has(toolName)) {
    const payload = buildTxReadyFromYieldOutput(toolName, output)
    return payload ? { payload, source: 'yield', toolName } : null
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
    // separately enforces approval⇄main⇄parent chain agreement. For a single-leg
    // prep envelope, guard the parent metadata too: the executor resolves top-level
    // `chain` / `from_chain` / `chain_id` BEFORE `txArgs`, so a conflicting parent
    // would otherwise sign the child tx on the wrong chain.
    const prepChain = resolvePrepChain(txArgs)
    if (!prepChain) return null
    const hasParentChainMetadata =
      asChainString(env.chain) !== undefined ||
      asChainString(env.from_chain) !== undefined ||
      asChainIdString(env.chain_id) !== undefined
    if (hasParentChainMetadata) {
      const parentChain = resolvePrepParentChain(env)
      if (!parentChain || parentChain !== prepChain) return null
    }
    // Multi-leg guard: a prep envelope's approval leg (`approvalTxArgs`) carries its
    // own chain metadata. The executor resolves that leg's `chain` BEFORE `chain_id`,
    // so a self-conflicting approval leg (e.g. `chain: Base, chain_id: 1`) resolves to
    // Base and can pass the approval⇄main comparison while its own metadata disagrees
    // — signing the APPROVAL on the wrong chain. Run the same fail-closed
    // self-consistency check and require the approval leg to match the main prep chain.
    const approvalTxArgs = asRecord(env.approvalTxArgs)
    if (approvalTxArgs) {
      const approvalChain = resolvePrepChain(approvalTxArgs)
      if (!approvalChain || approvalChain !== prepChain) return null
    }
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
