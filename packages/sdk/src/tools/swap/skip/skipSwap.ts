/**
 * Skip Go cross-chain route + unsigned-tx prep — pure crypto.
 *
 * Wraps `api.skip.build/v2/fungible/{route, msgs_direct}` to QUOTE a cross-chain
 * route and BUILD the unsigned transaction envelope (`unsigned_msgs`) for it.
 * This module NEVER signs and NEVER broadcasts — it returns the route quote +
 * the unsigned EVM/cosmos tx payloads for the caller (a vault layer / MPC
 * ceremony) to sign. It is the SDK-native form of mcp-ts's `runSkipSwap`.
 *
 * Skip covers cross-chain corridors that THORChain, Rujira, 1inch and LiFi
 * don't carry (e.g. Terra v2 / Terra Classic IBC + Osmosis poolmanager swaps).
 *
 * Fund-safety is enforced defensively at both the `/route` and `/msgs_direct`
 * boundaries:
 *   - multi-signature routes are rejected unless `allowMultiTx` is opted in
 *     (partial dispatch strands funds on an intermediate chain);
 *   - routes that custody funds on a chain Vultisig cannot derive a key for are
 *     rejected (unrecoverable on revert);
 *   - LUNC/USTC routes carry a USD notional floor + adaptive slippage +
 *     swap-hop budget (shallow Osmosis pool depth);
 *   - the source-leg cosmos memo size is preflighted against each chain's
 *     `x/auth.MaxMemoCharacters` cap;
 *   - the `/route` and `/msgs_direct` chain paths, `does_swap`, and per-tx chain
 *     ids are cross-checked so the displayed quote matches the signable envelope.
 *
 * Skip's grpc-gateway returns structured `{code, message, details}` errors;
 * `SkipApiError` surfaces `code` (stable) rather than regexing messages.
 */
import { buildSkipAffiliates, type SkipChainIdsToAffiliates } from './affiliateConfig'
import { skipChainIdToChainName } from './chainMapping'
import { assertNotValidatorHrp } from './cosmosAddressGuard'

/* ── constants ── */

const SKIP_BASE = 'https://api.skip.build'
const SKIP_ROUTE_PATH = '/v2/fungible/route'
const SKIP_MSGS_DIRECT_PATH = '/v2/fungible/msgs_direct'

const DEFAULT_SLIPPAGE_PERCENT = 1.0
const MAX_SLIPPAGE_PERCENT = 5.0

// Adaptive slippage for LUNC routes: thinner pools (higher quoted price impact)
// drift more over the ~25-min Axelar+IBC settlement window, so the safe buffer
// scales with the quoted impact instead of a static constant. Above the ceiling
// the pool is catastrophically thin for the size — reject rather than broadcast
// a doomed tx that would revert on the Osmosis leg and strand the bridged asset.
const LUNC_MAX_SLIPPAGE_PERCENT = 15.0
const LUNC_DRIFT_BASE_PERCENT = 1.0

const COLUMBUS_5 = 'columbus-5'

/**
 * Empirical floor — LUNC / USTC swap routes through Osmosis pools can fail
 * silently at execute time on shallow pool depth. Default $0.05 so small-but-
 * not-dust amounts can flow; overridable per-call via `luncNotionalFloorUsd`.
 */
export const DEFAULT_LUNC_NOTIONAL_FLOOR_USD = 0.05

export function resolveLuncFloorUsd(raw: number | undefined): number {
  if (raw === undefined) return DEFAULT_LUNC_NOTIONAL_FLOOR_USD
  // Allow 0 (explicit disable) but reject NaN / Infinity / negative.
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_LUNC_NOTIONAL_FLOOR_USD
  return raw
}

/* ── input type ── */

export type SkipSwapArgs = {
  fromAddress: string
  toAddress: string
  sourceChainId: string
  sourceAssetDenom: string
  destChainId: string
  destAssetDenom: string
  /** Raw base units as a positive integer string (wei / micro). */
  amountIn: string
  /** Max slippage as a percent. Default 1, max 5. */
  slippageTolerancePercent?: number
  /** Affiliate fee in bps (0-10000), honoured on /route only. */
  affiliateBps?: number
  /** Allow Skip to return multi-tx routes. Default false. */
  allowMultiTx?: boolean
  /** chain_id → address map for hops beyond source/dest. */
  intermediateAddresses?: Record<string, string>
  /** Override the LUNC/USTC USD notional floor (default $0.05). */
  luncNotionalFloorUsd?: number
}

/* ── error type ── */

/**
 * Structured error wrapping Skip's `{code, message, details}` envelope. The
 * `grpcCode` field is the gRPC status code Skip surfaces (3 = INVALID_ARGUMENT,
 * 5 = NOT_FOUND, 8 = RESOURCE_EXHAUSTED [rate limit], etc.). Callers should
 * branch on `grpcCode`, never on `message`.
 */
export class SkipApiError extends Error {
  readonly status: number
  readonly grpcCode: number | null
  readonly details: unknown

  constructor(status: number, grpcCode: number | null, message: string, details: unknown) {
    super(message)
    this.name = 'SkipApiError'
    this.status = status
    this.grpcCode = grpcCode
    this.details = details
  }

  toEnvelope(): {
    error: 'skip_api_error'
    status: number
    grpc_code: number | null
    message: string
    details: unknown
  } {
    return {
      error: 'skip_api_error',
      status: this.status,
      grpc_code: this.grpcCode,
      message: this.message,
      details: this.details,
    }
  }
}

/* ── Skip wire types (only fields we read) ── */

type SkipRouteResponse = {
  amount_in: string
  amount_out: string
  estimated_amount_out: string
  txs_required: number
  usd_amount_in?: string
  usd_amount_out?: string
  swap_venue?: { name: string; chain_id: string }
  swap_venues?: { name: string; chain_id: string }[]
  required_chain_addresses?: string[]
  estimated_route_duration_seconds?: number
  operations?: unknown[]
  chain_ids?: string[]
  does_swap?: boolean
  swap_price_impact_percent?: string
  message?: string // present on no-route errors instead of a 4xx
  code?: number
}

type SkipEvmTx = {
  chain_id: string
  to: string
  value: string
  data: string
  required_erc20_approvals?: { token_contract: string; spender: string; amount: string }[]
  signer_address: string
}

type SkipCosmosMsg = {
  msg: string // JSON-serialised msg body
  msg_type_url: string
}

type SkipCosmosTx = {
  chain_id: string
  path?: string[]
  msgs: SkipCosmosMsg[]
  signer_address: string
  memo?: string
}

type SkipMsgsDirectTx =
  | { evm_tx: SkipEvmTx; operations_indices?: number[] }
  | { cosmos_tx: SkipCosmosTx; operations_indices?: number[] }

type SkipMsgsDirectResponse = {
  txs: SkipMsgsDirectTx[]
  msgs: unknown[]
  min_amount_out: string
  route: SkipRouteResponse
}

/* ── helpers ── */

function isLuncRoute(sourceChainId: string, destChainId: string): boolean {
  return sourceChainId === COLUMBUS_5 || destChainId === COLUMBUS_5
}

function isEvmChainId(chainId: string): boolean {
  return /^[1-9][0-9]*$/.test(chainId)
}

/**
 * Returns the maximum number of swap operations allowed for a LUNC route.
 *   - Cosmos ↔ columbus-5 (both non-EVM): 2 swap ops (single-signature PFM
 *     routes execute atomically — no fund stranding).
 *   - EVM ↔ columbus-5 (cross-chain): 3 swap ops (EVM swap + bridge + Osmosis
 *     LUNC swap — the EVM leg is not an Osmosis pool hit).
 */
function luncSwapHopBudget(sourceChainId: string, destChainId: string): number {
  const crossChain = isEvmChainId(sourceChainId) || isEvmChainId(destChainId)
  if (crossChain) return 3
  return 2
}

/**
 * Enumerate the chain_ids at which the user's funds CUSTODY (land in their own
 * account) over a Skip route, and return the first one Vultisig cannot derive a
 * key for (or `null` when every custody chain is supported). Gates on
 * `required_chain_addresses` ∪ {source, dest} — pure transit (relayer hops the
 * user never custodies) is correctly not gated. `skipChainIdToChainName` is the
 * single source of truth for "Vultisig can derive a key here".
 */
function firstUnsupportedCustodyChain(
  sourceChainId: string,
  destChainId: string,
  requiredChainAddresses: string[] | undefined
): string | null {
  const custodyChains = new Set<string>([sourceChainId, destChainId, ...(requiredChainAddresses ?? [])])
  for (const chainId of custodyChains) {
    if (skipChainIdToChainName(chainId) === undefined) return chainId
  }
  return null
}

/**
 * Per-tx `MaxMemoCharacters` cap (bytes) from each chain's `x/auth` module. Skip
 * PFM routes encode the downstream flow in the source-leg memo, which can exceed
 * the cap (LUNC→USDC.eth observed at 1584 bytes vs columbus-5's 256-byte cap).
 * Values sourced from each chain's live `/cosmos/auth/v1beta1/params`.
 */
const COSMOS_MEMO_MAX_BYTES_BY_CHAIN_ID: Readonly<Record<string, number>> = {
  'columbus-5': 256,
  'phoenix-1': 256,
  'cosmoshub-4': 256,
  'osmosis-1': 256,
  'kaiyo-1': 256,
  'noble-1': 256,
}

/**
 * Extract the cosmos source-leg SDK transaction-level memo byte length from a
 * Skip /msgs_direct response, or `null` when no cosmos leg exists. cosmoshub-4 /
 * columbus-5 enforce the cap against the SDK transaction-level memo
 * (`cosmos_tx.memo`), NOT the inner ICS-20 packet memo (which is unbounded).
 */
function getSourceLegMemoByteLength(
  txs: ReadonlyArray<SkipMsgsDirectTx>
): { sourceChainId: string; memoBytes: number } | null {
  for (const tx of txs) {
    if (!tx || !('cosmos_tx' in tx)) continue
    const cosmosTx = tx.cosmos_tx
    const memo = typeof cosmosTx.memo === 'string' ? cosmosTx.memo : ''
    return {
      sourceChainId: cosmosTx.chain_id,
      memoBytes: Buffer.byteLength(memo, 'utf-8'),
    }
  }
  return null
}

/**
 * Resolve the effective slippage tolerance (percent) for a LUNC route, derived
 * per-quote from the route's price impact so the Osmosis swap leg COMPLETES
 * under settlement drift instead of reverting + stranding.
 *   buffer    = LUNC_DRIFT_BASE_PERCENT + impact   (route-derived drift buffer)
 *   effective = clamp(max(requested-or-default, buffer), 0, ceiling)
 * Missing / non-finite impact is NOT treated as 0% — fall back to the
 * requested-or-default slippage (never silently widen without a quoted impact).
 */
function resolveLuncSlippage(
  impactPercentRaw: string | null | undefined,
  requestedSlippage: number | undefined
): { ok: true; slippagePercent: number } | { ok: false; impactPercent: number } {
  const base = requestedSlippage ?? DEFAULT_SLIPPAGE_PERCENT
  const impact = impactPercentRaw == null ? NaN : parseFloat(impactPercentRaw)
  if (!Number.isFinite(impact) || impact < 0) {
    return { ok: true, slippagePercent: base }
  }
  const buffer = LUNC_DRIFT_BASE_PERCENT + impact
  if (buffer > LUNC_MAX_SLIPPAGE_PERCENT) {
    return { ok: false, impactPercent: impact }
  }
  const effective = Math.min(Math.max(base, buffer), LUNC_MAX_SLIPPAGE_PERCENT)
  return { ok: true, slippagePercent: effective }
}

/**
 * Count the effective pool-hop budget on a Skip `operations[]` array. Inspects
 * top-level swap op keys (`swap`, `swap_in`, `swap_out`, `smart_swap_in`,
 * `smart_swap_out`, `evm_swap`) AND nested pool hops inside a Cosmos swap op
 * (`swap_operations` arrays count as independent thin-pool hits). Transfer /
 * bridge ops are ignored.
 */
function countSwapOperations(operations: unknown[]): number {
  const SWAP_KEYS = new Set(['swap', 'swap_in', 'swap_out', 'smart_swap_in', 'smart_swap_out', 'evm_swap'])
  const NESTED_POOL_KEYS = new Set(['swap', 'swap_in', 'swap_out', 'smart_swap_in', 'smart_swap_out'])
  let count = 0
  for (const op of operations) {
    if (op == null || typeof op !== 'object') continue
    for (const key of Object.keys(op)) {
      if (!SWAP_KEYS.has(key)) continue
      if (NESTED_POOL_KEYS.has(key)) {
        const inner = (op as Record<string, unknown>)[key]
        if (inner != null && typeof inner === 'object') {
          let innerPoolCount = 0
          for (const innerKey of Object.keys(inner)) {
            const innerVal = (inner as Record<string, unknown>)[innerKey]
            if (
              innerVal != null &&
              typeof innerVal === 'object' &&
              'swap_operations' in innerVal &&
              Array.isArray((innerVal as Record<string, unknown>).swap_operations)
            ) {
              innerPoolCount = Math.max(
                innerPoolCount,
                ((innerVal as Record<string, unknown>).swap_operations as unknown[]).length
              )
            }
          }
          count += Math.max(1, innerPoolCount)
        } else {
          count++
        }
      } else {
        count++
      }
      break
    }
  }
  return count
}

function isUstcRoute(args: SkipSwapArgs): boolean {
  const ustcDenom = 'uusd'
  return (
    (args.sourceChainId === COLUMBUS_5 && args.sourceAssetDenom === ustcDenom) ||
    (args.destChainId === COLUMBUS_5 && args.destAssetDenom === ustcDenom)
  )
}

/**
 * Expected bech32 HRP per supported cosmos chain id. Without this the generic
 * `^[a-z]+1...` regex would accept `terra1...` for `cosmoshub-4` (and vice
 * versa) — the user signs with a vault-derived key on the wrong chain.
 */
const COSMOS_CHAIN_HRPS: Record<string, string> = {
  'cosmoshub-4': 'cosmos',
  'osmosis-1': 'osmo',
  'phoenix-1': 'terra',
  'columbus-5': 'terra',
  'noble-1': 'noble',
  'neutron-1': 'neutron',
  'kaiyo-1': 'kujira',
  'thorchain-1': 'thor',
  'mayachain-mainnet-v1': 'maya',
  'dydx-mainnet-1': 'dydx',
  'stride-1': 'stride',
  'agoric-3': 'agoric',
  celestia: 'celestia',
  'injective-1': 'inj',
}

function validateAddressShape(address: string, chainId: string, field: string): void {
  if (isEvmChainId(chainId)) {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(
        `${field}: chain_id ${chainId} is EVM, expected 0x-prefixed 40-hex (got "${address.slice(0, 16)}...")`
      )
    }
  } else {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error(`${field}: chain_id ${chainId} is cosmos, expected bech32 (got 0x-hex)`)
    }
    const bech32Match = address.match(/^([a-z][a-z0-9]*)1[02-9ac-hj-np-z]+$/)
    if (!bech32Match) {
      throw new Error(
        `${field}: chain_id ${chainId} expected bech32 (lowercase, contains "1" separator), got "${address.slice(0, 16)}..."`
      )
    }
    // Fund-safety: reject validator operator/consensus keys.
    assertNotValidatorHrp(bech32Match[1]!, field)
    const expectedHrp = COSMOS_CHAIN_HRPS[chainId]
    if (expectedHrp !== undefined && bech32Match[1] !== expectedHrp) {
      throw new Error(
        `${field}: chain_id ${chainId} expects bech32 HRP "${expectedHrp}", got "${bech32Match[1]}" (address "${address.slice(0, 24)}...")`
      )
    }
  }
}

/* ── HTTP layer ── */

/**
 * Direct fetch (no retry). Skip's 4xx/5xx errors are deterministic and 429
 * carries a `retry-after` header we surface verbatim.
 */
async function callSkip<T>(path: string, body: unknown): Promise<T> {
  const url = `${SKIP_BASE}${path}`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new SkipApiError(0, null, `skip api network error: ${message}`, null)
  }

  const text = await response.text()
  let parsed: unknown
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    throw new SkipApiError(
      response.status,
      null,
      `skip api returned non-JSON body (${response.status}): ${text.slice(0, 200)}`,
      null
    )
  }

  if (!response.ok) {
    const errBody = parsed as { code?: number; message?: string; details?: unknown } | null
    const msg = errBody?.message ?? `HTTP ${response.status}`
    const grpcCode = typeof errBody?.code === 'number' ? errBody.code : null
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
      throw new SkipApiError(
        429,
        grpcCode,
        `skip api rate-limited (retry-after: ${retryAfter ?? 'unset'}): ${msg}`,
        errBody?.details ?? null
      )
    }
    throw new SkipApiError(response.status, grpcCode, msg, errBody?.details ?? null)
  }

  return parsed as T
}

/* ── /route ── */

type RouteRequest = {
  source_asset_denom: string
  source_asset_chain_id: string
  dest_asset_denom: string
  dest_asset_chain_id: string
  amount_in: string
  allow_unsafe: true
  smart_relay: true
  smart_swap_options: { split_routes: boolean; evm_swaps: true }
  allow_multi_tx: boolean
  cumulative_affiliate_fee_bps?: string
}

/**
 * Quote a Skip route. Throws `SkipApiError` on Skip-side failures. LUNC routes
 * force `split_routes:false` (single-hop quotes — the post-fetch swap-op budget
 * still gates anything that slips through). Exported for quote-only callers.
 */
export async function quoteSkipRoute(args: SkipSwapArgs): Promise<SkipRouteResponse> {
  const isLuncEndpoint = isLuncRoute(args.sourceChainId, args.destChainId)
  const body: RouteRequest = {
    source_asset_denom: args.sourceAssetDenom,
    source_asset_chain_id: args.sourceChainId,
    dest_asset_denom: args.destAssetDenom,
    dest_asset_chain_id: args.destChainId,
    amount_in: args.amountIn,
    allow_unsafe: true,
    smart_relay: true,
    smart_swap_options: { split_routes: !isLuncEndpoint, evm_swaps: true },
    allow_multi_tx: args.allowMultiTx ?? false,
  }
  if (args.affiliateBps && args.affiliateBps > 0) {
    // Honoured on /route only — Skip silently drops it on /msgs_direct.
    body.cumulative_affiliate_fee_bps = String(args.affiliateBps)
  }

  const route = await callSkip<SkipRouteResponse>(SKIP_ROUTE_PATH, body)

  // Skip occasionally returns 200 with `{message: "no routes found"}` instead
  // of a 4xx — surface as SkipApiError(404).
  if (route.message && (!route.txs_required || route.txs_required <= 0)) {
    throw new SkipApiError(404, route.code ?? null, route.message, null)
  }

  return route
}

/* ── /msgs_direct ── */

type MsgsDirectRequest = {
  source_asset_denom: string
  source_asset_chain_id: string
  dest_asset_denom: string
  dest_asset_chain_id: string
  amount_in: string
  chain_ids_to_addresses: Record<string, string>
  slippage_tolerance_percent: string
  allow_unsafe: true
  smart_relay: true
  smart_swap_options: { split_routes: boolean; evm_swaps: true }
  allow_multi_tx: boolean
  chain_ids_to_affiliates?: SkipChainIdsToAffiliates
}

async function buildMsgs(
  args: SkipSwapArgs,
  chainIdsToAddresses: Record<string, string>,
  effectiveSlippagePercent?: number,
  swapChainId?: string
): Promise<SkipMsgsDirectResponse> {
  const slippage = effectiveSlippagePercent ?? args.slippageTolerancePercent ?? DEFAULT_SLIPPAGE_PERCENT
  const isLuncEndpoint = isLuncRoute(args.sourceChainId, args.destChainId)
  const body: MsgsDirectRequest = {
    source_asset_denom: args.sourceAssetDenom,
    source_asset_chain_id: args.sourceChainId,
    dest_asset_denom: args.destAssetDenom,
    dest_asset_chain_id: args.destChainId,
    amount_in: args.amountIn,
    chain_ids_to_addresses: chainIdsToAddresses,
    slippage_tolerance_percent: String(slippage),
    allow_unsafe: true,
    smart_relay: true,
    smart_swap_options: { split_routes: !isLuncEndpoint, evm_swaps: true },
    allow_multi_tx: args.allowMultiTx ?? false,
  }
  const affiliates = buildSkipAffiliates(swapChainId, args.affiliateBps)
  if (affiliates) {
    body.chain_ids_to_affiliates = affiliates
  }
  return callSkip<SkipMsgsDirectResponse>(SKIP_MSGS_DIRECT_PATH, body)
}

/* ── envelope shaping ── */

export type SkipUnsignedMsg =
  | {
      chain_id: string
      signing_method: 'evm'
      evm_tx: SkipEvmTx
    }
  | {
      chain_id: string
      signing_method: 'cosmos'
      cosmos_tx: SkipCosmosTx
    }

function shapeUnsignedMsgs(response: SkipMsgsDirectResponse): SkipUnsignedMsg[] {
  return response.txs.map(rawTx => {
    const tx = rawTx as { evm_tx?: SkipEvmTx | null; cosmos_tx?: SkipCosmosTx | null }
    if (tx.evm_tx != null) {
      return {
        chain_id: tx.evm_tx.chain_id,
        signing_method: 'evm' as const,
        evm_tx: tx.evm_tx,
      }
    }
    if (tx.cosmos_tx != null) {
      return {
        chain_id: tx.cosmos_tx.chain_id,
        signing_method: 'cosmos' as const,
        cosmos_tx: tx.cosmos_tx,
      }
    }
    throw new Error('shapeUnsignedMsgs: tx with neither evm_tx nor cosmos_tx (validation gap)')
  })
}

/* ── outcome types ── */

export type SkipSwapSuccess = {
  ok: true
  tx_type: 'skip_swap'
  tx_count: number
  /** True for multi-step routes (tx_count > 1) — caller must sign sequentially. */
  multi_tx: boolean
  quote: {
    amount_in: string
    amount_out: string
    expected_amount_out: string
    min_amount_out: string
    slippage_bps: number
    usd_amount_in: string | null
    usd_amount_out: string | null
    swap_venue: string | null
    swap_venues: string[]
    route_description: string
    swap_price_impact_percent: string | null
  }
  unsigned_msgs: SkipUnsignedMsg[]
  intermediate_addresses: Record<string, string>
  metadata: {
    skip_chain_path: string[]
    settlement_estimate_seconds: number | null
    required_chain_addresses: string[]
  }
  slippage_hint: string | null
}

export type SkipSwapErrorEnvelope = {
  error: string
  message: string
  [key: string]: unknown
}

export type SkipSwapOutcome = SkipSwapSuccess | { ok: false; envelope: SkipSwapErrorEnvelope }

const fail = (envelope: SkipSwapErrorEnvelope): SkipSwapOutcome => ({
  ok: false,
  envelope,
})

/* ── runSkipSwap helpers (extracted to keep cognitive complexity under sonarjs limit) ── */

function validateSwapInputs(args: SkipSwapArgs): SkipSwapErrorEnvelope | null {
  if (
    args.slippageTolerancePercent !== undefined &&
    (!Number.isFinite(args.slippageTolerancePercent) ||
      args.slippageTolerancePercent < 0 ||
      args.slippageTolerancePercent > MAX_SLIPPAGE_PERCENT)
  ) {
    return {
      error: 'invalid_input',
      message: `slippageTolerancePercent must be a finite number in [0, ${MAX_SLIPPAGE_PERCENT}] (got ${args.slippageTolerancePercent})`,
    }
  }

  try {
    validateAddressShape(args.fromAddress, args.sourceChainId, 'fromAddress')
    validateAddressShape(args.toAddress, args.destChainId, 'toAddress')
    for (const [chainId, addr] of Object.entries(args.intermediateAddresses ?? {})) {
      validateAddressShape(addr, chainId, `intermediateAddresses[${chainId}]`)
    }
  } catch (err) {
    return { error: 'invalid_input', message: err instanceof Error ? err.message : String(err) }
  }

  let amountInBigInt: bigint
  try {
    amountInBigInt = BigInt(args.amountIn)
  } catch (err) {
    return {
      error: 'invalid_input',
      message: `amountIn must be a base-units integer string (got "${args.amountIn}"): ${err instanceof Error ? err.message : String(err)}`,
    }
  }
  if (amountInBigInt <= 0n) {
    return { error: 'invalid_input', message: `amountIn must be > 0 (got "${args.amountIn}")` }
  }
  return null
}

type RouteValidationOk = {
  error: null
  provided: Record<string, string>
  chainIdsToAddresses: Record<string, string>
  effectiveSlippagePercent: number
  isThinPoolSwapRoute: boolean
  isUstcSwapRoute: boolean
}

function validateRouteResponse(
  route: SkipRouteResponse,
  args: SkipSwapArgs,
  luncFloorUsd: number
): { error: SkipSwapErrorEnvelope } | RouteValidationOk {
  if (typeof route.txs_required === 'number' && route.txs_required > 1 && args.allowMultiTx !== true) {
    return {
      error: {
        error: 'skip_multi_tx_route_rejected',
        message:
          `Skip route requires ${route.txs_required} sequential signatures; only ` +
          `single-signature (auto-forwarding PFM/GMP) routes are supported by ` +
          `default. Pass allowMultiTx:true to opt into the multi-step flow ` +
          `(only safe when the vault holds keys for every route chain).`,
        txs_required: route.txs_required,
        source_chain_id: args.sourceChainId,
        dest_chain_id: args.destChainId,
      },
    }
  }

  const unsupportedChain = firstUnsupportedCustodyChain(
    args.sourceChainId,
    args.destChainId,
    route.required_chain_addresses
  )
  if (unsupportedChain !== null) {
    return {
      error: {
        error: 'skip_unsupported_route_chain',
        message:
          `Skip route custodies funds on chain "${unsupportedChain}", which Vultisig ` +
          `cannot derive a key for. If a hop reverted there the funds would be ` +
          `unrecoverable, so we only permit routes whose every custody chain is ` +
          `supported. Try a different source/destination pair.`,
        chain_id: unsupportedChain,
        source_chain_id: args.sourceChainId,
        dest_chain_id: args.destChainId,
      },
    }
  }

  if (
    isLuncRoute(args.sourceChainId, args.destChainId) &&
    route.does_swap !== false &&
    Array.isArray(route.operations)
  ) {
    const swapOpsCount = countSwapOperations(route.operations)
    const hopBudget = luncSwapHopBudget(args.sourceChainId, args.destChainId)
    if (swapOpsCount > hopBudget) {
      return {
        error: {
          error: 'lunc_multi_hop_route_rejected',
          message:
            `LUNC swap routes are restricted to ${hopBudget} swap-op(s) for this route type to avoid ` +
            `shallow-pool failure on columbus-5 / osmosis pools. ` +
            `Skip returned a ${swapOpsCount}-swap-op route; refusing to quote. ` +
            `Try a different source/destination pair or a smaller amount.`,
          swap_operations_count: swapOpsCount,
          hop_budget: hopBudget,
          total_operations_count: route.operations.length,
          swap_price_impact_percent: route.swap_price_impact_percent ?? null,
          source_chain_id: args.sourceChainId,
          dest_chain_id: args.destChainId,
        },
      }
    }
  }

  const isLuncSwapRoute = isLuncRoute(args.sourceChainId, args.destChainId) && route.does_swap !== false
  const isUstcSwapRoute = isUstcRoute(args) && route.does_swap !== false
  const isThinPoolSwapRoute = isLuncSwapRoute || isUstcSwapRoute

  if (isThinPoolSwapRoute) {
    const denomLabel = isUstcSwapRoute ? 'USTC' : 'LUNC'
    const usdNotional = Math.max(Number(route.usd_amount_in ?? '0'), Number(route.usd_amount_out ?? '0'))
    if (!Number.isFinite(usdNotional) || usdNotional <= 0) {
      return {
        error: {
          error: `${denomLabel.toLowerCase()}_notional_unknown`,
          message:
            `${denomLabel} swap route returned a malformed or missing USD notional ` +
            `(usd_amount_in=${JSON.stringify(route.usd_amount_in)}, ` +
            `usd_amount_out=${JSON.stringify(route.usd_amount_out)}). Refusing to proceed.`,
          usd_in: route.usd_amount_in,
          usd_out: route.usd_amount_out,
          floor_usd: luncFloorUsd,
        },
      }
    }
    if (usdNotional < luncFloorUsd) {
      return {
        error: {
          error: `${denomLabel.toLowerCase()}_notional_below_floor`,
          message:
            `${denomLabel} swap routes require >= $${luncFloorUsd} USD-equivalent ` +
            `(got $${usdNotional.toFixed(2)}). Pool depth on the columbus-5 bridge path ` +
            `makes smaller swaps fail at execute time. Size up amountIn, or use a pure ` +
            `IBC transfer (does_swap=false).`,
          usd_in: route.usd_amount_in,
          usd_out: route.usd_amount_out,
          floor_usd: luncFloorUsd,
        },
      }
    }
  }

  const requiredChains = new Set(route.required_chain_addresses ?? [])
  requiredChains.delete(args.sourceChainId)
  requiredChains.delete(args.destChainId)
  const provided = args.intermediateAddresses ?? {}
  const allowedKeys = new Set([...(route.required_chain_addresses ?? []), args.sourceChainId, args.destChainId])

  const extraKeys = Object.keys(provided).filter(c => !allowedKeys.has(c))
  if (extraKeys.length > 0) {
    return {
      error: {
        error: 'intermediate_addresses_not_on_route',
        message:
          `intermediateAddresses contains chain ids that are NOT on the route ` +
          `(extra: ${extraKeys.join(', ')}). Only chains in route.required_chain_addresses ` +
          `(or source/dest) are accepted.`,
        extra_chains: extraKeys,
        allowed_chains: [...allowedKeys],
      },
    }
  }

  const missing = [...requiredChains].filter(c => !provided[c])
  if (missing.length > 0) {
    return {
      error: {
        error: 'intermediate_addresses_required',
        message: `route requires addresses on intermediate chains: ${missing.join(', ')}.`,
        required_chains: [...requiredChains],
        missing_chains: missing,
        quote_preview: {
          usd_amount_in: route.usd_amount_in,
          usd_amount_out: route.usd_amount_out,
          txs_required: route.txs_required,
          swap_venue: route.swap_venue?.name,
          estimated_route_duration_seconds: route.estimated_route_duration_seconds,
        },
      },
    }
  }

  const collidingChains = Object.keys(provided).filter(c => c === args.sourceChainId || c === args.destChainId)
  if (collidingChains.length > 0) {
    return {
      error: {
        error: 'invalid_input',
        message:
          `intermediateAddresses must not include source/dest chain ids ` +
          `(collides on: ${collidingChains.join(', ')}). Pass source/dest via ` +
          `fromAddress/toAddress only.`,
        colliding_chains: collidingChains,
      },
    }
  }

  const chainIdsToAddresses: Record<string, string> = {
    ...provided,
    [args.sourceChainId]: args.fromAddress,
    [args.destChainId]: args.toAddress,
  }

  let effectiveSlippagePercent = args.slippageTolerancePercent ?? DEFAULT_SLIPPAGE_PERCENT
  if (isLuncRoute(args.sourceChainId, args.destChainId) && route.does_swap !== false) {
    const resolved = resolveLuncSlippage(route.swap_price_impact_percent, args.slippageTolerancePercent)
    if (!resolved.ok) {
      return {
        error: {
          error: 'lunc_pool_impact_too_high',
          message:
            `LUNC pool too thin for this trade size: Skip quotes ${resolved.impactPercent}% ` +
            `price impact, above the ${LUNC_MAX_SLIPPAGE_PERCENT}% ceiling we permit for ` +
            `LUNC routes. Broadcasting would revert on the Osmosis leg and strand the ` +
            `bridged funds. Try a smaller or larger amount that fits the pool depth.`,
          swap_price_impact_percent: route.swap_price_impact_percent ?? null,
          max_slippage_percent: LUNC_MAX_SLIPPAGE_PERCENT,
          source_chain_id: args.sourceChainId,
          dest_chain_id: args.destChainId,
        },
      }
    }
    effectiveSlippagePercent = resolved.slippagePercent
  }

  return { error: null, provided, chainIdsToAddresses, effectiveSlippagePercent, isThinPoolSwapRoute, isUstcSwapRoute }
}

type MsgsValidationOk = { error: null; isMultiTx: boolean; msgsChainPath: string[] }

function validateMsgsResponse(
  msgs: SkipMsgsDirectResponse,
  route: SkipRouteResponse,
  args: SkipSwapArgs
): { error: SkipSwapErrorEnvelope } | MsgsValidationOk {
  if (!Array.isArray(msgs.txs) || msgs.txs.length === 0) {
    return {
      error: {
        error: 'skip_msgs_direct_no_txs',
        message:
          (msgs as { message?: string }).message ??
          'skip /msgs_direct returned 200 with no txs — route may have lapsed between /route and /msgs_direct',
        skip_message: (msgs as { message?: string }).message ?? null,
        skip_code: (msgs as { code?: number }).code ?? null,
      },
    }
  }
  if (!msgs.min_amount_out) {
    return {
      error: {
        error: 'skip_msgs_direct_no_min_amount_out',
        message: 'skip /msgs_direct returned 200 without min_amount_out — refusing to sign without a slippage floor',
      },
    }
  }

  const routeChainPath = route.chain_ids ?? []
  const msgsChainPath = msgs.route?.chain_ids ?? []
  if (routeChainPath.length === 0 || msgsChainPath.length === 0) {
    return {
      error: {
        error: 'skip_route_msgs_chain_path_missing',
        message:
          'Skip /route or /msgs_direct returned without a chain_ids path — refusing to sign ' +
          'because the route-vs-envelope integrity check requires both to declare the chain path.',
        route_chain_path: routeChainPath,
        msgs_chain_path: msgsChainPath,
      },
    }
  }
  if (JSON.stringify(routeChainPath) !== JSON.stringify(msgsChainPath)) {
    return {
      error: {
        error: 'skip_route_msgs_chain_path_mismatch',
        message:
          'Skip /route and /msgs_direct returned different chain paths — refusing to sign because ' +
          'the displayed quote no longer matches the envelope',
        route_chain_path: routeChainPath,
        msgs_chain_path: msgsChainPath,
      },
    }
  }
  if (route.does_swap !== msgs.route?.does_swap) {
    return {
      error: {
        error: 'skip_route_msgs_does_swap_mismatch',
        message:
          'Skip /route and /msgs_direct disagree on does_swap — refusing to sign because the floor ' +
          'decision was made on a route shape that does not match the envelope',
        route_does_swap: route.does_swap,
        msgs_route_does_swap: msgs.route?.does_swap,
      },
    }
  }

  const msgsTxsRequired = msgs.route?.txs_required
  const isMultiTx = (typeof msgsTxsRequired === 'number' && msgsTxsRequired > 1) || msgs.txs.length > 1
  if (isMultiTx && args.allowMultiTx !== true) {
    return {
      error: {
        error: 'skip_multi_tx_route_rejected',
        message:
          `Skip /msgs_direct returned a multi-signature route ` +
          `(txs_required=${msgsTxsRequired ?? 'unset'}, txs.length=${msgs.txs.length}); ` +
          `single-signature (auto-forwarding PFM/GMP) is the default. Pass allowMultiTx:true ` +
          `to opt into multi-step signing (only safe when the vault holds keys for every ` +
          `route chain — the custody-chain gate enforces this).`,
        txs_required: msgsTxsRequired ?? null,
        txs_length: msgs.txs.length,
        source_chain_id: args.sourceChainId,
        dest_chain_id: args.destChainId,
      },
    }
  }

  if (!isMultiTx) {
    const memoInfo = getSourceLegMemoByteLength(msgs.txs)
    const cap = memoInfo ? COSMOS_MEMO_MAX_BYTES_BY_CHAIN_ID[memoInfo.sourceChainId] : undefined
    if (memoInfo && cap !== undefined && memoInfo.memoBytes > cap) {
      return {
        error: {
          error: 'skip_source_memo_too_long',
          message:
            `Skip route's source-leg memo is ${memoInfo.memoBytes} bytes, but ` +
            `${memoInfo.sourceChainId} enforces a ${cap}-byte limit. Broadcast would fail with ` +
            `sdk code 12 "memo too long" after signing. This corridor requires a multi-step ` +
            `route (pass allowMultiTx:true) or a different routing strategy.`,
          source_chain_id: memoInfo.sourceChainId,
          memo_bytes: memoInfo.memoBytes,
          memo_max_bytes: cap,
        },
      }
    }
  }

  const msgsUnsupportedChain = firstUnsupportedCustodyChain(
    args.sourceChainId,
    args.destChainId,
    msgs.route?.required_chain_addresses
  )
  if (msgsUnsupportedChain !== null) {
    return {
      error: {
        error: 'skip_unsupported_route_chain',
        message:
          `Skip /msgs_direct route custodies funds on chain "${msgsUnsupportedChain}", which ` +
          `Vultisig cannot derive a key for. Refusing to sign a route whose funds could come ` +
          `to rest on an unrecoverable chain.`,
        chain_id: msgsUnsupportedChain,
        source_chain_id: args.sourceChainId,
        dest_chain_id: args.destChainId,
      },
    }
  }

  if (isLuncRoute(args.sourceChainId, args.destChainId) && msgs.route?.does_swap !== false) {
    if (!Array.isArray(msgs.route?.operations)) {
      return {
        error: {
          error: 'lunc_msgs_direct_operations_missing',
          message:
            'Skip /msgs_direct response is missing `route.operations` on a LUNC path — the ' +
            'hop-budget invariant cannot be verified against the envelope we would sign.',
          source_chain_id: args.sourceChainId,
          dest_chain_id: args.destChainId,
        },
      }
    }
    const msgsSwapOpsCount = countSwapOperations(msgs.route.operations)
    const hopBudget = luncSwapHopBudget(args.sourceChainId, args.destChainId)
    if (msgsSwapOpsCount > hopBudget) {
      return {
        error: {
          error: 'lunc_multi_hop_route_rejected',
          message:
            `LUNC swap routes are restricted to ${hopBudget} swap-op(s) for this route type. ` +
            `Skip /msgs_direct returned a ${msgsSwapOpsCount}-swap-op route in the envelope; ` +
            `refusing to sign.`,
          swap_operations_count: msgsSwapOpsCount,
          hop_budget: hopBudget,
          total_operations_count: (msgs.route.operations as unknown[]).length,
          swap_price_impact_percent: msgs.route.swap_price_impact_percent ?? null,
          source_chain_id: args.sourceChainId,
          dest_chain_id: args.destChainId,
        },
      }
    }
  }

  return { error: null, isMultiTx, msgsChainPath }
}

function validateTxEnvelopes(txs: unknown[], msgsChainPath: string[]): SkipSwapErrorEnvelope | null {
  const canonicalChains = new Set(msgsChainPath)
  for (let i = 0; i < txs.length; i++) {
    const txRaw = txs[i]
    if (txRaw == null || typeof txRaw !== 'object') {
      return {
        error: 'skip_msgs_tx_malformed',
        message: `Skip /msgs_direct tx ${i} is not an object — refusing to sign a malformed envelope.`,
        tx_index: i,
      }
    }
    const tx = txRaw as { evm_tx?: { chain_id?: unknown } | null; cosmos_tx?: { chain_id?: unknown } | null }
    const hasEvm = tx.evm_tx !== undefined && tx.evm_tx !== null
    const hasCosmos = tx.cosmos_tx !== undefined && tx.cosmos_tx !== null
    if (hasEvm === hasCosmos) {
      return {
        error: 'skip_msgs_tx_malformed',
        message: `Skip /msgs_direct tx ${i} must have exactly one of evm_tx or cosmos_tx (got hasEvm=${hasEvm}, hasCosmos=${hasCosmos}) — refusing to sign a malformed envelope.`,
        tx_index: i,
      }
    }
    const txChainRaw = hasEvm ? tx.evm_tx?.chain_id : tx.cosmos_tx?.chain_id
    if (typeof txChainRaw !== 'string' || txChainRaw.length === 0) {
      return {
        error: 'skip_msgs_tx_missing_chain_id',
        message: `Skip /msgs_direct tx ${i} is missing a non-empty chain_id — refusing to sign without an explicit tx chain id.`,
        tx_index: i,
      }
    }
    if (!canonicalChains.has(txChainRaw)) {
      return {
        error: 'skip_msgs_tx_chain_off_path',
        message: `Skip /msgs_direct tx ${i} declares chain_id=${txChainRaw} which is NOT on the canonical chain path [${msgsChainPath.join(', ')}] — refusing to sign an off-route tx.`,
        tx_index: i,
        tx_chain_id: txChainRaw,
        canonical_chain_path: msgsChainPath,
      }
    }
  }
  return null
}

/**
 * Quote + build a Skip swap envelope. Returns a structured outcome so callers
 * can inspect `intermediate_addresses_required` and retry with derived hop
 * addresses. NEVER signs or broadcasts — `unsigned_msgs` carries the unsigned
 * EVM/cosmos tx payloads for the caller's signing layer.
 */
export async function runSkipSwap(args: SkipSwapArgs): Promise<SkipSwapOutcome> {
  const luncFloorUsd = resolveLuncFloorUsd(args.luncNotionalFloorUsd)

  const inputErr = validateSwapInputs(args)
  if (inputErr !== null) return fail(inputErr)

  let route: SkipRouteResponse
  try {
    route = await quoteSkipRoute(args)
  } catch (err) {
    if (err instanceof SkipApiError) return fail(err.toEnvelope())
    throw err
  }

  const routeResult = validateRouteResponse(route, args, luncFloorUsd)
  if (routeResult.error !== null) return fail(routeResult.error)
  const { provided, chainIdsToAddresses, effectiveSlippagePercent, isThinPoolSwapRoute, isUstcSwapRoute } = routeResult

  let msgs: SkipMsgsDirectResponse
  try {
    msgs = await buildMsgs(args, chainIdsToAddresses, effectiveSlippagePercent, route.swap_venue?.chain_id)
  } catch (err) {
    if (err instanceof SkipApiError) return fail(err.toEnvelope())
    throw err
  }

  const msgsResult = validateMsgsResponse(msgs, route, args)
  if (msgsResult.error !== null) return fail(msgsResult.error)
  const { isMultiTx, msgsChainPath } = msgsResult

  const txEnvErr = validateTxEnvelopes(msgs.txs as unknown[], msgsChainPath)
  if (txEnvErr !== null) return fail(txEnvErr)

  const unsignedMsgs = shapeUnsignedMsgs(msgs)
  const slippageBps = Math.round(effectiveSlippagePercent * 100)

  const BELOW_MIN_NOTIONAL_THRESHOLD_USD = 1.0
  const usdAmountIn = Number(msgs.route.usd_amount_in ?? '0')
  const belowMinNotionalHint: string | null =
    msgs.route?.does_swap !== false &&
    Number.isFinite(usdAmountIn) &&
    usdAmountIn > 0 &&
    usdAmountIn < BELOW_MIN_NOTIONAL_THRESHOLD_USD
      ? `swapping ~$${usdAmountIn.toFixed(2)} USD-equivalent is below most providers' minimums ` +
        `and may cost more in gas than you receive. try >= $${BELOW_MIN_NOTIONAL_THRESHOLD_USD} ` +
        `USD-equivalent for a more cost-effective swap.`
      : null

  const slippageHint = (() => {
    if (isThinPoolSwapRoute) {
      const denomLabel = isUstcSwapRoute ? 'USTC' : 'LUNC'
      const usd = Math.max(Number(route.usd_amount_in ?? '0'), Number(route.usd_amount_out ?? '0'))
      if (usd < 20) {
        return (
          `${denomLabel} route under $20 USD-equivalent — destination pool is thin. ` +
          `Slippage tolerance is set adaptively to cover the quoted price impact ` +
          `(up to ${LUNC_MAX_SLIPPAGE_PERCENT}% for LUNC routes).`
        )
      }
    }
    return belowMinNotionalHint
  })()

  return {
    ok: true,
    tx_type: 'skip_swap',
    tx_count: msgs.txs.length,
    multi_tx: isMultiTx,
    quote: {
      amount_in: msgs.route.amount_in,
      amount_out: msgs.route.amount_out,
      expected_amount_out: msgs.route.estimated_amount_out,
      min_amount_out: msgs.min_amount_out,
      slippage_bps: slippageBps,
      usd_amount_in: msgs.route.usd_amount_in ?? null,
      usd_amount_out: msgs.route.usd_amount_out ?? null,
      swap_venue: msgs.route.swap_venue?.name ?? null,
      swap_venues: (msgs.route.swap_venues ?? []).map(v => v.name),
      route_description: describeRoute(msgs.route),
      swap_price_impact_percent: msgs.route.swap_price_impact_percent ?? null,
    },
    unsigned_msgs: unsignedMsgs,
    intermediate_addresses: provided,
    metadata: {
      skip_chain_path: msgs.route.chain_ids ?? [],
      settlement_estimate_seconds: msgs.route.estimated_route_duration_seconds ?? null,
      required_chain_addresses: msgs.route.required_chain_addresses ?? [],
    },
    slippage_hint: slippageHint,
  }
}

/* ── route description helper ── */

function describeRoute(route: SkipRouteResponse): string {
  const path = route.chain_ids ?? []
  const venues = (route.swap_venues ?? []).map(v => v.name)
  if (path.length === 0) return 'unknown'
  if (venues.length === 0) return path.join(' → ')
  return `${path.join(' → ')} via ${venues.join(' + ')}`
}
