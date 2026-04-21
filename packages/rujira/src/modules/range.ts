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

function assertShare(v: string): void {
  assertDecimal4('share', v)
  // Parse strictly. Reject 0 and >1. Allow "1" and "1.0".
  const n = Number.parseFloat(v)
  if (!(n > 0 && n <= 1)) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `share must be in (0, 1] (got ${v})`)
  }
}

function assertPairAddress(a: string): void {
  if (typeof a !== 'string' || !a.startsWith('thor1') || a.length < 20) {
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
  // Structural check: high > low.
  if (Number.parseFloat(c.high) <= Number.parseFloat(c.low)) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `config.high (${c.high}) must be > config.low (${c.low})`)
  }
  // Spread reasonability: 0 < spread < 1 (contract likely enforces, but catch early).
  const s = Number.parseFloat(c.spread)
  if (!(s > 0 && s < 1)) {
    throw new RujiraError(RujiraErrorCode.INVALID_PARAMS, `config.spread must be in (0, 1) (got ${c.spread})`)
  }
  // Fee must not exceed spread.
  const f = Number.parseFloat(c.fee)
  if (f < 0 || f > s) {
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
  const response = await fetch(RUJIRA_GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))

  if (!response.ok) {
    throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL request failed: ${response.status}`)
  }
  const json = (await response.json()) as GraphQLResponse<T>
  if (json.errors?.length) {
    throw new RujiraError(RujiraErrorCode.NETWORK_ERROR, `GraphQL errors: ${json.errors[0].message}`)
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

const PAIR_QUERY = `
  query FinPairByAssets($base: String!, $quote: String!) {
    finPair(base: $base, quote: $quote) {
      address
      assetBase  { metadata { symbol } variants { native { denom } } }
      assetQuote { metadata { symbol } variants { native { denom } } }
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
  const config: RangeConfig | undefined =
    r.high && r.low && r.spread && r.skew !== undefined && r.fee !== undefined
      ? { high: r.high, low: r.low, spread: r.spread, skew: r.skew, fee: r.fee }
      : undefined
  return {
    idx: r.idx,
    pairAddress: r.pair?.address ?? '',
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
      return edges.map(e => mapRange(e.node))
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
      if (!data?.node) return null
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
        finPair: {
          address: string
          assetBase: { metadata?: { symbol?: string }; variants?: { native?: { denom?: string } } }
          assetQuote: { metadata?: { symbol?: string }; variants?: { native?: { denom?: string } } }
        } | null
      }>(PAIR_QUERY, { base, quote })
      if (!data?.finPair) return null
      return {
        address: data.finPair.address,
        base: {
          symbol: data.finPair.assetBase.metadata?.symbol ?? base,
          denom: data.finPair.assetBase.variants?.native?.denom ?? '',
        },
        quote: {
          symbol: data.finPair.assetQuote.metadata?.symbol ?? quote,
          denom: data.finPair.assetQuote.variants?.native?.denom ?? '',
        },
      }
    } catch (error) {
      throw wrapError(error)
    }
  }
}
