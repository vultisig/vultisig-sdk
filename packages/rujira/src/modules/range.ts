/**
 * RUJI Trade Custom Concentrated Liquidity (CCL) — range positions.
 *
 * CCL positions live on the rujira-fin orderbook pair contract (v1.2+),
 * NOT on the BOW AMM contract. Each position is identified by `idx` (bigint
 * as string, scoped per pair). Users create a position with a price range
 * (high/low), spread, skew, and fee, then the position automatically market-
 * makes across the range, compounding and/or accruing claimable yield.
 *
 * Message shapes mirror the upstream rujira-ui `Range.tsx` / `RangeManage.tsx`
 * verbatim — any drift there is load-bearing and must be updated in lockstep.
 *
 * @module modules/range
 */
import type { Coin } from '@cosmjs/proto-signing'

import type { RujiraClient } from '../client.js'
import { RujiraError, RujiraErrorCode, wrapError } from '../errors.js'
import { base64Encode } from '../utils/encoding.js'
import { validateThorAddress } from '../validation/address-validator.js'

const RUJIRA_GRAPHQL_URL = 'https://api.vultisig.com/ruji/api/graphql'
const GRAPHQL_TIMEOUT_MS = 15_000

/** Scale of MOIC and DPI fields in analytics (divide raw bigint by this). */
export const RANGE_MOIC_SCALE = 1e12
/** Scale of APR field in analytics (divide raw bigint by this). */
export const RANGE_APR_SCALE = 1e10
/** Fractional digits used by config Decimal fields (high/low/spread/skew/fee). */
export const RANGE_CONFIG_DECIMALS = 12
/** Fractional digits used by the withdraw share parameter. */
export const RANGE_WITHDRAW_SHARE_DECIMALS = 4

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** CosmWasm MsgExecuteContract payload — flat shape for one msg. */
export type RangeTransactionParams = {
  contractAddress: string
  executeMsg: object
  funds: Coin[]
}

/**
 * Multi-msg payload for atomic close (claim + withdraw 100%).
 * Callers MUST sign + broadcast all msgs in a SINGLE cosmos tx so they are
 * atomic. Two separate txs would leak state between claim and withdraw.
 */
export type RangeMultiTransactionParams = {
  msgs: RangeTransactionParams[]
}

/** Parameters for a CCL range position config. */
export type RangeConfig = {
  /** Upper price bound (Decimal string, up to 12 fractional digits). Above this, position is 100% quote. */
  high: string
  /** Lower price bound (Decimal string, 12 dp). Below this, position is 100% base. */
  low: string
  /** Target profit per round trip (Decimal string, 12 dp, 0 < spread < 1). */
  spread: string
  /** Distribution shape parameter (Decimal string, 12 dp, signed). Upstream UI presets use 0. */
  skew: string
  /** Fraction of spread retained as claimable yield (Decimal string, 12 dp). Set equal to spread for accurate APR analytics. */
  fee: string
}

export type CreatePositionParams = {
  pairAddress: string
  config: RangeConfig
  /** Base asset coin to deposit. Amount in smallest unit (string). */
  base: Coin
  /** Quote asset coin to deposit. Amount in smallest unit (string). */
  quote: Coin
}

export type DepositParams = {
  pairAddress: string
  idx: string
  base: Coin
  quote: Coin
}

export type WithdrawParams = {
  pairAddress: string
  idx: string
  /**
   * Share of the position to withdraw, as a Decimal string with up to 4 fractional
   * digits. 0 < share <= 1. Pass "1" for a full withdraw (but note this leaves
   * unclaimed fees behind — use `buildWithdrawAll` for the atomic close path).
   */
  share: string
}

export type ClaimParams = {
  pairAddress: string
  idx: string
}

export type TransferParams = {
  pairAddress: string
  idx: string
  /** Destination thor1... address. Validated before building. */
  to: string
}

export type WithdrawAllParams = {
  pairAddress: string
  idx: string
}

/** Analytics snapshot for a range position (scaled — use constants above to divide). */
export type RangeAnalytics = {
  /** Multiple on Invested Capital, scaled by RANGE_MOIC_SCALE. */
  moic?: string
  /** Distributed Paid-In ratio, scaled by RANGE_MOIC_SCALE. */
  dpi?: string
  /** Annualized yield from claimable profits, scaled by RANGE_APR_SCALE. Only meaningful when fee > 0. */
  apr?: string
  /** First deposit ISO timestamp. */
  firstDepositDate?: string
}

export type RangePosition = {
  idx: string
  pairAddress: string
  base: string
  quote: string
  feesBase: string
  feesQuote: string
  /** Principal value in USD base units (8 dp). */
  principalUsd?: string
  /** Claimable yield value in USD base units (8 dp). */
  yieldUsd?: string
  config?: RangeConfig
  analytics?: RangeAnalytics
}

export type FinPair = {
  address: string
  base: { symbol: string; denom: string }
  quote: { symbol: string; denom: string }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const DECIMAL_12_RE = /^-?\d+(\.\d{1,12})?$/
const DECIMAL_4_RE = /^\d+(\.\d{1,4})?$/
const IDX_RE = /^\d+$/

function assertDecimal12(label: string, v: string): void {
  if (typeof v !== 'string' || !DECIMAL_12_RE.test(v)) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `${label} must be a Decimal string with up to 12 fractional digits (got ${JSON.stringify(v)})`
    )
  }
}

function assertDecimal4(label: string, v: string): void {
  if (typeof v !== 'string' || !DECIMAL_4_RE.test(v)) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `${label} must be a Decimal string with up to 4 fractional digits (got ${JSON.stringify(v)})`
    )
  }
}

function assertIdx(v: string): void {
  if (typeof v !== 'string' || !IDX_RE.test(v)) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `idx must be a non-negative integer string (got ${JSON.stringify(v)})`
    )
  }
}

function assertCoin(label: string, c: Coin): void {
  if (!c || typeof c.denom !== 'string' || !c.denom || typeof c.amount !== 'string' || !/^\d+$/.test(c.amount)) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `${label} must be a Coin with string denom and integer-string amount`
    )
  }
}

const RANGE_CONFIG_SCALE = 10n ** BigInt(RANGE_CONFIG_DECIMALS)
const RANGE_WITHDRAW_SHARE_SCALE = 10n ** BigInt(RANGE_WITHDRAW_SHARE_DECIMALS)

// Scale a validated Decimal-string (matched by DECIMAL_12_RE / DECIMAL_4_RE) to a BigInt
// with `decimals` fractional digits. Avoids parseFloat to preserve precision.
function decimalToScaled(v: string, decimals: number): bigint {
  const scale = 10n ** BigInt(decimals)
  const sign = v.startsWith('-') ? -1n : 1n
  const unsigned = v.startsWith('-') ? v.slice(1) : v
  const [whole, fraction = ''] = unsigned.split('.')
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals)
  return sign * (BigInt(whole || '0') * scale + BigInt(paddedFraction || '0'))
}

function assertShare(v: string): void {
  assertDecimal4('share', v)
  // 0 < share <= 1, compared in scaled BigInt space (reject 0 and >1).
  const scaled = decimalToScaled(v, RANGE_WITHDRAW_SHARE_DECIMALS)
  if (!(scaled > 0n && scaled <= RANGE_WITHDRAW_SHARE_SCALE)) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `share must be in (0, 1] (got ${v})`)
  }
}

function assertPairAddress(a: string): void {
  if (typeof a !== 'string') {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `pairAddress must be a bech32 thor1... contract address (got ${JSON.stringify(a)})`
    )
  }
  try {
    validateThorAddress(a)
  } catch {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `pairAddress must be a bech32 thor1... contract address (got ${JSON.stringify(a)})`
    )
  }
}

function assertConfig(c: RangeConfig): void {
  assertDecimal12('config.high', c.high)
  assertDecimal12('config.low', c.low)
  assertDecimal12('config.spread', c.spread)
  assertDecimal12('config.skew', c.skew)
  assertDecimal12('config.fee', c.fee)
  // Scaled BigInt comparisons — avoids parseFloat so 12dp precision is preserved.
  const high = decimalToScaled(c.high, RANGE_CONFIG_DECIMALS)
  const low = decimalToScaled(c.low, RANGE_CONFIG_DECIMALS)
  const spread = decimalToScaled(c.spread, RANGE_CONFIG_DECIMALS)
  const fee = decimalToScaled(c.fee, RANGE_CONFIG_DECIMALS)
  if (low <= 0n) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `config.low (${c.low}) must be > 0`)
  }
  if (high <= low) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `config.high (${c.high}) must be > config.low (${c.low})`)
  }
  // Spread reasonability: 0 < spread < 1 (contract likely enforces, but catch early).
  if (!(spread > 0n && spread < RANGE_CONFIG_SCALE)) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `config.spread must be in (0, 1) (got ${c.spread})`)
  }
  // Fee must not exceed spread.
  if (fee < 0n || fee > spread) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `config.fee must be in [0, spread] (got ${c.fee} vs spread ${c.spread})`
    )
  }
}

// ---------------------------------------------------------------------------
// GraphQL
// ---------------------------------------------------------------------------

type GraphQLResponse<T> = { data: T; errors?: Array<{ message: string }> }

async function gqlFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), GRAPHQL_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(RUJIRA_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    })
  } catch (error) {
    // AbortError from the timeout above would otherwise fall through to wrapError's
    // default NETWORK_ERROR branch (its "timeout"/"timed out" string match misses
    // the "The operation was aborted." message). Translate it to a proper TIMEOUT.
    if (error instanceof Error && error.name === 'AbortError') {
      throw new RujiraError(
        RujiraErrorCode.TIMEOUT,
        `GraphQL request timed out after ${GRAPHQL_TIMEOUT_MS}ms`,
        error,
        true
      )
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL request failed: ${response.status}`)
  }
  const json = (await response.json()) as GraphQLResponse<T>
  if (json.errors?.length) {
    throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL errors: ${json.errors[0].message}`)
  }
  // Review finding: a malformed backend response (200 OK, no `errors`,
  // no `data`) would return undefined and downstream callers would
  // collapse it to "no positions" / "no pair" via their `?? []` / `??
  // null` fallbacks — masking a real backend/schema break as a silent
  // empty result. Users would make fund-moving decisions on false
  // negatives. Reject at the transport boundary instead.
  if (json.data === undefined || json.data === null) {
    throw new RujiraError(
      RujiraErrorCode.NETWORK_ERROR,
      'GraphQL response missing `data` field (backend or schema error)'
    )
  }
  return json.data
}

// Query shapes — keep narrow, only fields we surface.
// NOTE: FinRange + FinPair schema is taken from rujira-ui `TradeSubscriptions`.
// If upstream schema changes, these queries must be updated in lockstep.

// Queries follow the schema at api.vultisig.com/ruji/api/graphql as of
// 2026-04-21. Paths verified via __type introspection:
//   Account.fin.ranges → FinRangeConnection (Relay edges/node)
//   FinRange.{idx,base,quote,feesBase,feesQuote,principalUsd,yieldUsd,
//             high,low,spread,skew,fee,price,valueUsd,pair,analytics}
// Config fields are FLAT on FinRange (not under a nested config object).

const POSITIONS_QUERY = `
  query RangePositions($id: ID!) {
    node(id: $id) {
      ... on Account {
        fin {
          ranges(first: 100) {
            edges {
              node {
                id idx base quote
                feesBase feesQuote
                principalUsd yieldUsd
                high low spread skew fee price
                pair { id address }
                analytics { moic dpi apr firstDepositDate status }
              }
            }
          }
        }
      }
    }
  }
`

const POSITION_QUERY = `
  query RangePosition($id: ID!) {
    node(id: $id) {
      ... on FinRange {
        id idx base quote
        feesBase feesQuote
        principalUsd yieldUsd
        high low spread skew fee price
        pair { id address }
        analytics { moic dpi apr firstDepositDate status }
      }
    }
  }
`

// Pair lookup goes through finV3.pairs sorted by volume. We fetch the top N
// and do (base, quote) matching client-side on symbols AND denoms — tolerating
// LLM-mangled inputs like "xruji" (stripped "x/ruji") or "thorrune"
// (stripped "thor.rune") by normalising separators on both sides.
const PAIR_QUERY = `
  query FinPairsAll {
    finV3 {
      pairs(first: 200, sortBy: VOLUME, sortDir: DESC) {
        edges {
          node {
            address
            assetBase  { metadata { symbol } variants { native { denom } } }
            assetQuote { metadata { symbol } variants { native { denom } } }
          }
        }
      }
    }
  }
`

type FinRangeRaw = {
  idx: string
  base: string
  quote: string
  feesBase: string
  feesQuote: string
  principalUsd?: string
  yieldUsd?: string
  high?: string
  low?: string
  spread?: string
  skew?: string
  fee?: string
  pair?: { address: string }
  analytics?: RangeAnalytics
}

function mapRange(r: FinRangeRaw): RangePosition {
  if (!r.pair?.address) {
    throw new RujiraError(
      RujiraErrorCode.INVALID_PARAMS,
      `FinRange ${r.idx} is missing pair.address (partial/error GraphQL response?)`
    )
  }
  const config: RangeConfig | undefined =
    r.high && r.low && r.spread && r.skew !== undefined && r.fee !== undefined
      ? { high: r.high, low: r.low, spread: r.spread, skew: r.skew, fee: r.fee }
      : undefined
  return {
    idx: r.idx,
    pairAddress: r.pair.address,
    base: r.base,
    quote: r.quote,
    feesBase: r.feesBase,
    feesQuote: r.feesQuote,
    principalUsd: r.principalUsd,
    yieldUsd: r.yieldUsd,
    config,
    analytics: r.analytics,
  }
}

// ---------------------------------------------------------------------------
// RujiraRange
// ---------------------------------------------------------------------------

/**
 * Builders + queries for RUJI Trade CCL range positions.
 *
 * ExecuteMsg shapes (keep in sync with `rujira-ui` Range.tsx / RangeManage.tsx):
 *
 * - create:   `{ range: { create:   { config: { high, low, spread, skew, fee } } } }`
 * - deposit:  `{ range: { deposit:  { idx } } }`
 * - withdraw: `{ range: { withdraw: { idx, amount } } }`  (amount is the share Decimal 4dp)
 * - claim:    `{ range: { claim:    { idx } } }`
 * - transfer: `{ range: { transfer: { idx, to } } }`
 */
export class RujiraRange {
  private readonly client: RujiraClient

  constructor(client: RujiraClient) {
    this.client = client
  }

  // ------------------- Builders -------------------

  buildCreatePosition(params: CreatePositionParams): RangeTransactionParams {
    assertPairAddress(params.pairAddress)
    assertConfig(params.config)
    assertCoin('base', params.base)
    assertCoin('quote', params.quote)
    return {
      contractAddress: params.pairAddress,
      executeMsg: {
        range: {
          create: {
            config: {
              high: params.config.high,
              low: params.config.low,
              spread: params.config.spread,
              skew: params.config.skew,
              fee: params.config.fee,
            },
          },
        },
      },
      funds: [params.base, params.quote].sort((a, b) => (a.denom < b.denom ? -1 : 1)),
    }
  }

  buildDeposit(params: DepositParams): RangeTransactionParams {
    assertPairAddress(params.pairAddress)
    assertIdx(params.idx)
    assertCoin('base', params.base)
    assertCoin('quote', params.quote)
    return {
      contractAddress: params.pairAddress,
      executeMsg: { range: { deposit: { idx: params.idx } } },
      funds: [params.base, params.quote].sort((a, b) => (a.denom < b.denom ? -1 : 1)),
    }
  }

  buildWithdraw(params: WithdrawParams): RangeTransactionParams {
    assertPairAddress(params.pairAddress)
    assertIdx(params.idx)
    assertShare(params.share)
    return {
      contractAddress: params.pairAddress,
      executeMsg: { range: { withdraw: { idx: params.idx, amount: params.share } } },
      funds: [],
    }
  }

  buildClaim(params: ClaimParams): RangeTransactionParams {
    assertPairAddress(params.pairAddress)
    assertIdx(params.idx)
    return {
      contractAddress: params.pairAddress,
      executeMsg: { range: { claim: { idx: params.idx } } },
      funds: [],
    }
  }

  buildTransfer(params: TransferParams): RangeTransactionParams {
    assertPairAddress(params.pairAddress)
    assertIdx(params.idx)
    validateThorAddress(params.to)
    return {
      contractAddress: params.pairAddress,
      executeMsg: { range: { transfer: { idx: params.idx, to: params.to } } },
      funds: [],
    }
  }

  /**
   * Atomic close: claim fees + withdraw 100%. Emits two MsgExecuteContract
   * payloads that MUST be signed + broadcast in a single cosmos tx. The order
   * matters — claim first, then withdraw — to guarantee fees are harvested.
   */
  buildWithdrawAll(params: WithdrawAllParams): RangeMultiTransactionParams {
    assertPairAddress(params.pairAddress)
    assertIdx(params.idx)
    return {
      msgs: [
        {
          contractAddress: params.pairAddress,
          executeMsg: { range: { claim: { idx: params.idx } } },
          funds: [],
        },
        {
          contractAddress: params.pairAddress,
          executeMsg: { range: { withdraw: { idx: params.idx, amount: '1' } } },
          funds: [],
        },
      ],
    }
  }

  // ------------------- Queries -------------------

  /**
   * List open range positions for a THORChain address.
   * Returns [] when the account has no positions.
   */
  async getPositions(owner: string): Promise<RangePosition[]> {
    validateThorAddress(owner)
    try {
      const nodeId = base64Encode(`Account:${owner}`)
      const data = await gqlFetch<{
        node?: { fin?: { ranges?: { edges?: Array<{ node: FinRangeRaw }> } } }
      }>(POSITIONS_QUERY, { id: nodeId })
      const edges = data?.node?.fin?.ranges?.edges ?? []
      // Filter out partial/malformed rows before mapping — mapRange throws on missing pair.address.
      return edges.filter(e => !!e.node?.pair?.address).map(e => mapRange(e.node))
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Fetch a single range position by (pairAddress, idx).
   * Returns null when the position doesn't exist.
   */
  async getPosition(pairAddress: string, idx: string): Promise<RangePosition | null> {
    assertPairAddress(pairAddress)
    assertIdx(idx)
    try {
      const nodeId = base64Encode(`FinRange:${pairAddress}:${idx}`)
      const data = await gqlFetch<{ node?: FinRangeRaw | null }>(POSITION_QUERY, { id: nodeId })
      if (!data?.node || !data.node.pair?.address) return null
      return mapRange(data.node)
    } catch (error) {
      throw wrapError(error)
    }
  }

  /**
   * Resolve a FIN pair contract address from base + quote asset identifiers
   * (denom or THORChain ticker). Returns null when the pair doesn't exist.
   */
  async getPairAddress(base: string, quote: string): Promise<FinPair | null> {
    if (!base || !quote) {
      throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, 'base and quote are required')
    }
    try {
      const data = await gqlFetch<{
        finV3: {
          pairs: {
            edges: Array<{
              node: {
                address: string
                assetBase: { metadata?: { symbol?: string }; variants?: { native?: { denom?: string } } }
                assetQuote: { metadata?: { symbol?: string }; variants?: { native?: { denom?: string } } }
              }
            }>
          }
        }
      }>(PAIR_QUERY, {})
      const edges = data?.finV3?.pairs?.edges ?? []
      // Accept tickers, bank denoms, FIN-pair denoms ("thor.rune"), and
      // LLM-mangled forms ("xruji" from "x/ruji", "thorrune" from "thor.rune")
      // by normalising separators out and matching with suffix tolerance
      // (normalised "thorrune" ends with normalised "rune" → match).
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
      // Three-tier match: exact > prefix > suffix. Exact takes precedence
      // so ambiguous inputs like "ETH" don't silently match a WETH pair
      // just because `weth.endsWith("eth")`. We also reject multi-hit
      // fuzzy ambiguity — if two different pairs would pass the fuzzy
      // tier, the caller must disambiguate.
      const matchTier = (input: string, candidate: string): 'exact' | 'fuzzy' | null => {
        if (!input || !candidate) return null
        const a = norm(input)
        const b = norm(candidate)
        if (a === b) return 'exact'
        if (a.endsWith(b) || b.endsWith(a)) return 'fuzzy'
        return null
      }
      type Node = (typeof edges)[number]['node']
      const scoreNode = (n: Node): 'exact' | 'fuzzy' | null => {
        const bs = n.assetBase.metadata?.symbol ?? ''
        const qs = n.assetQuote.metadata?.symbol ?? ''
        const bd = n.assetBase.variants?.native?.denom ?? ''
        const qd = n.assetQuote.variants?.native?.denom ?? ''
        const baseTier = (() => {
          const s = matchTier(base, bs)
          const d = matchTier(base, bd)
          if (s === 'exact' || d === 'exact') return 'exact' as const
          if (s === 'fuzzy' || d === 'fuzzy') return 'fuzzy' as const
          return null
        })()
        const quoteTier = (() => {
          const s = matchTier(quote, qs)
          const d = matchTier(quote, qd)
          if (s === 'exact' || d === 'exact') return 'exact' as const
          if (s === 'fuzzy' || d === 'fuzzy') return 'fuzzy' as const
          return null
        })()
        if (!baseTier || !quoteTier) return null
        // Pair is as weak as its weakest side.
        return baseTier === 'exact' && quoteTier === 'exact' ? 'exact' : 'fuzzy'
      }
      const scored = edges.map(e => e.node).map(n => ({ node: n, tier: scoreNode(n) }))
      const exact = scored.filter(s => s.tier === 'exact').map(s => s.node)
      const fuzzy = scored.filter(s => s.tier === 'fuzzy').map(s => s.node)

      let match: Node | undefined
      if (exact.length === 1) {
        match = exact[0]
      } else if (exact.length > 1) {
        // Multiple exact-match pairs (shouldn't happen on a sane pair
        // list, but reject rather than pick-first to avoid routing to
        // the wrong pair).
        throw new RujiraError(
          RujiraErrorCode.INVALID_PARAMS,
          `ambiguous pair: ${base}/${quote} matches ${exact.length} pairs exactly`
        )
      } else if (fuzzy.length === 1) {
        match = fuzzy[0]
      } else if (fuzzy.length > 1) {
        throw new RujiraError(
          RujiraErrorCode.INVALID_PARAMS,
          `ambiguous pair: ${base}/${quote} matches ${fuzzy.length} pairs fuzzily — use exact denoms or tickers`
        )
      }
      if (!match) return null
      return {
        address: match.address,
        base: {
          symbol: match.assetBase.metadata?.symbol ?? base,
          denom: match.assetBase.variants?.native?.denom ?? '',
        },
        quote: {
          symbol: match.assetQuote.metadata?.symbol ?? quote,
          denom: match.assetQuote.variants?.native?.denom ?? '',
        },
      }
    } catch (error) {
      throw wrapError(error)
    }
  }
}
