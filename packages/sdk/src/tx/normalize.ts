/**
 * Pure tx-shape normalization + multi-tx splitting.
 *
 * Ports the *normalize/split* half of the agent-backend's
 * `enrichBuildResult` (internal/service/agent/agent.go) and `splitMultiTx`
 * (internal/service/agent/tx_sequence.go) into a vault-free, side-effect-free
 * SDK primitive.
 *
 * What stays in the backend (NOT ported here):
 *   - SSE event sequencing (tx_ready emission ordering, pendingTxReadyEvents)
 *   - Redis sequence storage / pop / peek / drained-marker lifecycle
 *   - sequence_id / sequence_index / sequence_total injection (per-turn,
 *     per-user, Redis-scoped — runtime concern, not a pure shape transform)
 *   - the produces_calldata dispatch gate + any agent-judgement
 *
 * This module is PURE: it takes an already-built tool result (JSON) and
 * returns a canonical tx envelope (`normalizeTx`) or an ordered list of
 * per-leg envelopes (`splitMultiTx`). It never signs, broadcasts, or reads
 * chain state.
 */

/** A parsed JSON object whose values are themselves arbitrary JSON. */
type JsonObject = Record<string, unknown>

/**
 * A canonical, signing-ready tx envelope. Always carries the inner tx under one
 * of `tx` / `swap_tx` / `send_tx`, plus optional chain-routing metadata copied
 * from the build args / parent envelope. Extra fields ride along unchanged.
 */
export type NormalizedTx = JsonObject & {
  tx?: unknown
  swap_tx?: unknown
  send_tx?: unknown
  chain?: string
  chain_id?: string
  from_chain?: string
  to_chain?: string
}

/**
 * Chain-routing args from the originating `build_*` tool call. Mirrors the
 * `{from_chain, to_chain, chain}` probe in Go `enrichBuildResult`. All optional
 * — a flat single-chain `build_evm_tx` only carries `chain`.
 */
export type NormalizeArgs = {
  from_chain?: string
  to_chain?: string
  chain?: string
}

/** Thrown when a build result can't be parsed into a tx envelope. */
export class TxNormalizeError extends Error {
  override readonly name = 'TxNormalizeError'

  constructor(message: string) {
    super(message)
  }
}

const isJsonObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Parse a build result into a plain object. Accepts either a JSON string (the
 * raw MCP tool result, mirroring the Go `result string` input) or an
 * already-parsed object. Throws `TxNormalizeError` on anything that isn't a
 * JSON object (arrays, primitives, malformed JSON) — the Go code returned nil
 * here; in TS we surface it so callers don't silently drop a tx.
 */
const parseResult = (result: string | JsonObject): JsonObject => {
  if (isJsonObject(result)) return { ...result }
  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch (e) {
    throw new TxNormalizeError(`build result is not valid JSON: ${(e as Error).message}`)
  }
  if (!isJsonObject(parsed)) {
    throw new TxNormalizeError('build result is not a JSON object')
  }
  return parsed
}

/**
 * `execute_*` prep envelopes (mcp-ts#49) are self-describing via `txArgs` +
 * `stepperConfig` and dispatch on the inner `txArgs.tx_encoding` discriminator.
 * Wrapping them under `tx` would double-nest and break consumers that switch on
 * `txArgs.tx_encoding`, so the wrap step is skipped for them.
 */
const isExecutePrep = (txMap: JsonObject): boolean => 'txArgs' in txMap && 'stepperConfig' in txMap

/**
 * Phantom-card guard (vultiagent-app#603 part B): an `execute_*` prep envelope
 * whose `txArgs` lacks a `tx_encoding` discriminator is structurally malformed —
 * the client `parseServerTx` cannot route it to any signing branch. The Go code
 * returned nil here so tx_ready is never emitted; we throw so the caller can
 * count + drop it explicitly.
 */
const assertExecutePrepRoutable = (txMap: JsonObject): void => {
  const txArgs = txMap['txArgs']
  const encoding = isJsonObject(txArgs) ? txArgs['tx_encoding'] : undefined
  if (typeof encoding !== 'string' || encoding === '') {
    throw new TxNormalizeError('execute_* prep envelope missing txArgs.tx_encoding discriminator (phantom card)')
  }
}

/**
 * Normalize a `build_*` tool result into a canonical tx envelope.
 *
 * Mirrors Go `enrichBuildResult`:
 *   - If the result already carries a nested tx (`swap_tx` / `send_tx` / `tx`),
 *     or is an `execute_*` prep envelope, it is enriched in place.
 *   - Otherwise the whole result IS the transaction and gets wrapped under
 *     `tx` (with `chain` / `chain_id` lifted to the outer level so chain
 *     resolution keeps working).
 *   - Chain-routing fields (`from_chain` / `to_chain` / `chain`) are filled
 *     from `args` when the payload doesn't already carry them.
 *
 * Pure: no I/O, no signing, no broadcast. Returns a fresh object.
 *
 * @throws {TxNormalizeError} on unparseable input or a non-routable
 *   `execute_*` prep envelope (phantom card).
 */
export const normalizeTx = (result: string | JsonObject, args: NormalizeArgs = {}): NormalizedTx => {
  let txMap = parseResult(result)

  const executePrep = isExecutePrep(txMap)
  if (executePrep) {
    assertExecutePrepRoutable(txMap)
  }

  const hasNestedTx = 'swap_tx' in txMap || 'send_tx' in txMap || 'tx' in txMap

  // Flat build_* result with no nested tx and not an execute_* prep envelope:
  // the whole result IS the transaction, wrap it under "tx" and lift chain
  // metadata to the outer level for downstream chain resolution.
  if (!executePrep && !hasNestedTx) {
    const wrapped: JsonObject = { tx: { ...txMap } }
    if ('chain' in txMap) wrapped['chain'] = txMap['chain']
    if ('chain_id' in txMap) wrapped['chain_id'] = txMap['chain_id']
    txMap = wrapped
  }

  // Enrich with chain-routing info from the originating tool-call args when the
  // payload doesn't already carry it. from_chain falls back to chain (matches
  // Go: single-chain ops set from_chain = chain).
  const { from_chain: argFrom, to_chain: argTo, chain: argChain } = args
  if (!('from_chain' in txMap)) {
    if (argFrom) txMap['from_chain'] = argFrom
    else if (argChain) txMap['from_chain'] = argChain
  }
  if (!('chain' in txMap) && argChain) txMap['chain'] = argChain
  if (!('to_chain' in txMap) && argTo) txMap['to_chain'] = argTo

  return txMap as NormalizedTx
}

/**
 * Metadata fields copied from a multi-tx parent onto each split leg so that
 * `chain` / `chain_id` / `provider` / symbols / addresses / decimals ride along
 * on every leg. Matches the `metadataKeys` slice in Go `wrapSingleTx`.
 */
const LEG_METADATA_KEYS = [
  'chain',
  'chain_id',
  'from_chain',
  'to_chain',
  'provider',
  'from_symbol',
  'to_symbol',
  'from_address',
  'to_address',
  'from_decimals',
  'to_decimals',
] as const

/**
 * Wrap a single child tx under `txKey` and copy routing metadata from the
 * parent envelope. Mirrors Go `wrapSingleTx`.
 */
const wrapSingleTx = (txKey: string, txData: unknown, parent: JsonObject): NormalizedTx => {
  const leg: JsonObject = { [txKey]: txData }
  for (const key of LEG_METADATA_KEYS) {
    if (key in parent) leg[key] = parent[key]
  }
  return leg as NormalizedTx
}

/**
 * Split a (possibly multi-) tx build result into an ordered list of per-leg
 * envelopes. Mirrors Go `splitMultiTx`.
 *
 * Two patterns are recognised, in priority order:
 *   - Pattern 1 (swap-with-approval): top-level `needs_approval === true` with
 *     both `approval_tx` and `swap_tx` present -> `[approvalLeg, swapLeg]`,
 *     ordered approval-first. The approval is wrapped under `tx`, the swap
 *     under `swap_tx`.
 *   - Pattern 2 (generic): a top-level `transactions` array with length >= 1 ->
 *     each element wrapped under `tx` with parent metadata copied on. Fires on
 *     len >= 1 (not > 1) so single-tx canonical responses (Morpho borrow /
 *     withdraw, etc.) also get per-tx wrapping instead of falling through.
 *
 * If neither pattern matches, the result is normalized via {@link normalizeTx}
 * and returned as a single-element array — a no-op for single-tx callers.
 *
 * Pure: no Redis, no sequence_id injection, no SSE. Each leg is a fresh object.
 *
 * @throws {TxNormalizeError} on unparseable input.
 */
export const splitMultiTx = (result: string | JsonObject, args: NormalizeArgs = {}): NormalizedTx[] => {
  let parsed: JsonObject
  try {
    parsed = parseResult(result)
  } catch {
    // Go returns the original payload as a single element on parse failure.
    // We can only do that if it was already an object; a bad string is fatal.
    if (isJsonObject(result)) return [result as NormalizedTx]
    throw new TxNormalizeError('build result is not valid JSON')
  }

  // Pattern 1: swap with approval.
  if (parsed['needs_approval'] === true && 'approval_tx' in parsed && 'swap_tx' in parsed) {
    return [wrapSingleTx('tx', parsed['approval_tx'], parsed), wrapSingleTx('swap_tx', parsed['swap_tx'], parsed)]
  }

  // Pattern 2: generic transactions array (len >= 1).
  const txs = parsed['transactions']
  if (Array.isArray(txs) && txs.length > 0) {
    return txs.map(child => wrapSingleTx('tx', child, parsed))
  }

  // Neither pattern: normalize the single tx and return as a 1-element list.
  return [normalizeTx(parsed, args)]
}
