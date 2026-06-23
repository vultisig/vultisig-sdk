// sdk.defi.pendle — Pendle Finance PT (Principal Token) trade builders.
//
// PT = a Principal Token, redeems 1:1 to the underlying at maturity → buying it
//      at a discount locks a FIXED yield to expiry.
// YT = a Yield Token, streams the underlying's yield until maturity → buying it
//      is a LEVERAGED bet that realized yield beats the implied rate (can → 0).
//
// All builders use Pendle's Hosted SDK Convert API, which returns ready router
// calldata (tx.to = Router V4) + the exact ERC20 requiredApprovals. We emit the
// router tx in `tx` and the prerequisite approve in `approval` (the consumer
// steps approve→sign). NOTHING is signed or broadcast here — the consumer gates
// signing.
//
// Ported from mcp-ts buildPendleBuyPt / buildPendleSellPt / buildPendleRedeem +
// pendleMarkets / pendleMarket.

import {
  encodeErc20Approve,
  PENDLE_ROUTER_V4,
  PENDLE_SUPPORTED_CHAINS,
  type PendleActiveMarket,
  pendleActiveMarkets,
  type PendleChain,
  pendleChainId,
  pendleConvert,
  stripChainPrefix,
} from './pendleApi'

export type { PendleActiveMarket, PendleChain }
export { isPendleChain, PENDLE_ROUTER_V4, PENDLE_SUPPORTED_CHAINS, stripChainPrefix } from './pendleApi'

// --- read: market discovery ---

export type PendleMarketSummary = {
  name: string
  market: string
  pt: string
  yt: string
  sy: string
  underlying: string
  expiry: string
  /** PT buyer's headline number: the fixed yield locked to maturity (decimal, e.g. 0.0812 = 8.12%). */
  ptFixedApy: number | null
  /** YT buyer's context: the underlying's raw yield. */
  underlyingApy: number | null
  /** YT realized-yield band. */
  ytYieldRange: { min: number; max: number } | null
  liquidityUsd: number | null
}

function projectMarket(m: PendleActiveMarket): PendleMarketSummary {
  const d = m.details ?? {}
  return {
    name: m.name,
    market: stripChainPrefix(m.address),
    pt: stripChainPrefix(m.pt),
    yt: stripChainPrefix(m.yt),
    sy: stripChainPrefix(m.sy),
    underlying: stripChainPrefix(m.underlyingAsset),
    expiry: m.expiry,
    ptFixedApy: d.impliedApy ?? null,
    underlyingApy: d.underlyingApy ?? null,
    ytYieldRange: d.yieldRange ? { min: d.yieldRange.min, max: d.yieldRange.max } : null,
    liquidityUsd: d.liquidity ?? null,
  }
}

export type PendleMarketsParams = {
  chain: PendleChain
  /** Optional case-insensitive filter on the market/underlying name. */
  underlying?: string
  /** Max markets to return (default 25, by liquidity desc). */
  limit?: number
}

/**
 * List active (non-expired) Pendle markets on a supported EVM chain, sorted by
 * liquidity desc. Read-only — builds no transaction.
 */
export async function pendleMarkets(params: PendleMarketsParams): Promise<PendleMarketSummary[]> {
  const filter = params.underlying ? params.underlying.trim().toLowerCase() : ''
  const limit = params.limit ?? 25
  let markets = await pendleActiveMarkets(params.chain)
  if (filter) {
    markets = markets.filter(
      m => m.name?.toLowerCase().includes(filter) || stripChainPrefix(m.underlyingAsset).toLowerCase() === filter
    )
  }
  markets.sort((a, b) => (b.details?.liquidity ?? 0) - (a.details?.liquidity ?? 0))
  return markets.slice(0, limit).map(projectMarket)
}

export type PendleMarketParams = {
  chain: PendleChain
  /** The Pendle market contract address (0x…), as returned by pendleMarkets. */
  market: string
}

/**
 * Get one active Pendle market by its market address. Returns null if no active
 * market matches (expired or on another chain). Read-only.
 */
export async function pendleMarket(params: PendleMarketParams): Promise<PendleMarketSummary | null> {
  const target = stripChainPrefix(params.market).trim().toLowerCase()
  const markets = await pendleActiveMarkets(params.chain)
  const found = markets.find(m => stripChainPrefix(m.address).toLowerCase() === target)
  return found ? projectMarket(found) : null
}

// --- build: unsigned PT trade txs ---

// Static gas-limit fallbacks (decimal wei). Pendle's Convert API returns no gas
// estimate and a client's eth_estimateGas reverts on the router call before the
// ERC20 approval is mined, so the envelope must carry a fallback or the
// broadcast aborts. Actual gas used is far below these caps.
const ROUTER_GAS_LIMIT = '2000000' // Pendle router swap + aggregator hop
const APPROVE_GAS_LIMIT = '120000' // standard ERC20 approve

/** A single unsigned EVM tx leg. No signature, no broadcast. */
export type PendleUnsignedTx = {
  chain: PendleChain
  chainId: number
  from: string
  to: string
  value: string
  data: string
  gasLimit: string
}

export type PendlePtBuildResult = {
  action: 'buy_pt' | 'sell_pt'
  /** The Pendle Router V4 call (the main leg). */
  tx: PendleUnsignedTx
  /** ERC20 approve(router, amount) the consumer must sign FIRST, if required. undefined for native input. */
  approval?: PendleUnsignedTx
  /** Ordered signing steps (approve→sign when approval present). */
  steps: { id: string; label: string }[]
  meta: {
    protocol: 'Pendle Finance'
    router: string
    market: string
    method: string | null
    amountInBaseUnits: string
    expectedOutBaseUnits: string | null
    expectedOutToken: string | null
    impliedApyAfter: number | null
    priceImpact: number | null
    approvalRequired: boolean
    note: string
  }
}

export class PendleBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PendleBuildError'
  }
}

type BuildConvertOpts = {
  action: 'buy_pt' | 'sell_pt'
  chain: PendleChain
  market: string
  pt: string
  underlying: string
  tokensIn: string
  tokensOut: string
  amount: string
  /** Slippage tolerance in PERCENT (0–50, default 1 = 1%). */
  slippagePct?: number
  from: string
  /** Optional affiliate / fee-recipient address. INJECTABLE; default off (neutral). */
  affiliate?: string
}

// Shared Convert→envelope builder. `tokensIn`/`tokensOut` are bare 0x addresses
// (PT/underlying), `amount` is wei of tokenIn's OWN decimals. Returns the router
// tx envelope + the prerequisite ERC20 approve (if any) so the consumer steps
// approve→sign. NEVER signs, NEVER broadcasts.
async function buildPendleConvertTx(opts: BuildConvertOpts): Promise<PendlePtBuildResult> {
  const { action, chain, market, pt, underlying, tokensIn, tokensOut, amount, from, affiliate } = opts
  if (!from) {
    throw new PendleBuildError('pendle: a `from` wallet address is required to build the transaction.')
  }

  // Trust-but-verify: the requested market/pt/underlying must match a live
  // active market before we ever build signable calldata.
  const requestedMarket = stripChainPrefix(market).toLowerCase()
  const requestedPt = stripChainPrefix(pt).toLowerCase()
  const requestedUnderlying = stripChainPrefix(underlying).toLowerCase()
  const activeMarkets = await pendleActiveMarkets(chain)
  const matchedMarket = activeMarkets.find(m => stripChainPrefix(m.address).toLowerCase() === requestedMarket)
  if (!matchedMarket) {
    throw new PendleBuildError(
      `pendle: no active market ${market} on ${chain}; call pendleMarkets again before building.`
    )
  }
  const marketPt = stripChainPrefix(matchedMarket.pt).toLowerCase()
  const marketUnderlying = stripChainPrefix(matchedMarket.underlyingAsset).toLowerCase()
  if (marketPt !== requestedPt || marketUnderlying !== requestedUnderlying) {
    throw new PendleBuildError(
      `pendle: market/token mismatch for ${market}; expected pt=${stripChainPrefix(matchedMarket.pt)} ` +
        `and underlying=${stripChainPrefix(matchedMarket.underlyingAsset)}.`
    )
  }

  const slippage = Math.min(Math.max(opts.slippagePct ?? 1, 0), 50) / 100 // pct → 0–1, clamp 0–50%
  const chainId = pendleChainId(chain)
  const res = await pendleConvert({
    chainId,
    tokensIn,
    amountsIn: amount,
    tokensOut,
    receiver: from,
    slippage,
    enableAggregator: true,
    aggregatorReceiver: affiliate, // injectable; undefined = off (neutral)
  })

  const route = res.routes?.[0]
  if (!route?.tx?.to || !route.tx.data) {
    throw new PendleBuildError('pendle: Convert returned no executable route.')
  }
  // The router target must be Pendle Router V4 — refuse to build otherwise.
  if (route.tx.to.toLowerCase() !== PENDLE_ROUTER_V4.toLowerCase()) {
    throw new PendleBuildError(
      `pendle: unexpected router ${route.tx.to} (expected Pendle Router V4 ${PENDLE_ROUTER_V4}); refusing to build.`
    )
  }
  const value = route.tx.value && route.tx.value !== '0' ? route.tx.value : '0'

  const mkTx = (tx: { to: string; value: string; data: string; gasLimit: string }): PendleUnsignedTx => ({
    chain,
    chainId,
    from,
    to: tx.to,
    value: tx.value,
    data: tx.data,
    gasLimit: tx.gasLimit,
  })

  const approvalReq = res.requiredApprovals?.[0]
  const out = route.outputs?.[0]
  const approval = approvalReq
    ? mkTx({
        to: approvalReq.token,
        value: '0',
        data: encodeErc20Approve(PENDLE_ROUTER_V4, approvalReq.amount),
        gasLimit: APPROVE_GAS_LIMIT,
      })
    : undefined

  const steps = approval
    ? [
        { id: 'approve', label: 'Approve token spend' },
        { id: 'sign', label: 'Sign Pendle transaction' },
        { id: 'broadcast', label: 'Submit on-chain' },
      ]
    : [
        { id: 'sign', label: 'Sign Pendle transaction' },
        { id: 'broadcast', label: 'Submit on-chain' },
      ]

  return {
    action,
    tx: mkTx({ to: route.tx.to, value, data: route.tx.data, gasLimit: ROUTER_GAS_LIMIT }),
    ...(approval ? { approval } : {}),
    steps,
    meta: {
      protocol: 'Pendle Finance',
      router: PENDLE_ROUTER_V4,
      market,
      method: route.contractParamInfo?.method ?? null,
      amountInBaseUnits: amount,
      expectedOutBaseUnits: out?.amount ?? null,
      expectedOutToken: out?.token ? stripChainPrefix(out.token) : null,
      impliedApyAfter: route.data?.impliedApy?.after ?? null,
      priceImpact: route.data?.priceImpact ?? null,
      approvalRequired: !!approval,
      note: 'Built from Pendle Hosted SDK Convert. Consumer steps approve→router. UNSIGNED — not broadcast here.',
    },
  }
}

export type BuildBuyPtParams = {
  chain: PendleChain
  /** Pendle market contract address (0x…), from pendleMarkets. */
  market: string
  /** The PT token address for this market (the `pt` field from pendleMarkets). */
  pt: string
  /** The underlying/deposit token address (e.g. USDC). What you pay (unless tokenIn is set). */
  underlying: string
  /** The token the user PAYS WITH, if different from the market underlying. Defaults to `underlying`. */
  tokenIn?: string
  /** Amount of the pay token, in base units of THAT token's OWN decimals. */
  amount: string
  /** Slippage tolerance in percent (default 1 = 1%). */
  slippage?: number
  /** Sender wallet address. */
  from: string
  /** Optional affiliate / fee-recipient address. INJECTABLE; default off (neutral). */
  affiliate?: string
}

/**
 * Build a Pendle BUY-PT transaction: swap a token INTO the Principal Token,
 * locking the market's fixed yield to maturity. Pay with the underlying OR any
 * other token — Pendle's router aggregates the conversion in one tx.
 * Returns UNSIGNED router calldata + the prerequisite ERC20 approval. Never
 * signs, never broadcasts.
 */
export async function buildBuyPt(params: BuildBuyPtParams): Promise<PendlePtBuildResult> {
  return buildPendleConvertTx({
    action: 'buy_pt',
    chain: params.chain,
    market: params.market,
    pt: params.pt,
    underlying: params.underlying,
    tokensIn: params.tokenIn ?? params.underlying,
    tokensOut: params.pt,
    amount: params.amount,
    slippagePct: params.slippage,
    from: params.from,
    affiliate: params.affiliate,
  })
}

export type BuildSellPtParams = {
  chain: PendleChain
  market: string
  pt: string
  underlying: string
  /** Amount of PT to sell, in base units (PT inherits the underlying's decimals). */
  amount: string
  slippage?: number
  from: string
  affiliate?: string
}

/**
 * Build a Pendle SELL-PT transaction: swap the Principal Token back INTO the
 * underlying (exit a fixed-yield position BEFORE maturity). Returns UNSIGNED
 * router calldata + the prerequisite ERC20 approval. Never signs, never
 * broadcasts. Use buildRedeem once the market has expired (PT redeems 1:1).
 */
export async function buildSellPt(params: BuildSellPtParams): Promise<PendlePtBuildResult> {
  return buildPendleConvertTx({
    action: 'sell_pt',
    chain: params.chain,
    market: params.market,
    pt: params.pt,
    underlying: params.underlying,
    tokensIn: params.pt,
    tokensOut: params.underlying,
    amount: params.amount,
    slippagePct: params.slippage,
    from: params.from,
    affiliate: params.affiliate,
  })
}

export type BuildRedeemParams = {
  chain: PendleChain
  market: string
  pt: string
  underlying: string
  /** Amount of PT to redeem, in base units. */
  amount: string
  slippage?: number
  from: string
  affiliate?: string
}

/**
 * Check whether a Pendle PT can be redeemed at maturity.
 *
 * Mature redemption is intentionally FAIL-CLOSED until an expired-market source
 * is money-tested: this surface only verifies the active-market catalog, so it
 * must not relabel an active-market sell route as a 1:1 mature redeem. Throws a
 * structured PendleBuildError in both cases (market still active → use
 * buildSellPt; market expired → redemption not enabled yet). Builds no signable
 * calldata.
 */
export async function buildRedeem(params: BuildRedeemParams): Promise<never> {
  const activeMarkets = await pendleActiveMarkets(params.chain)
  const target = stripChainPrefix(params.market).toLowerCase()
  const active = activeMarkets.find(m => stripChainPrefix(m.address).toLowerCase() === target)
  if (active) {
    throw new PendleBuildError(
      'pendle.buildRedeem: market is still active; use buildSellPt to exit before maturity. ' +
        'Refusing to label an active-market PT sell route as a 1:1 mature redeem.'
    )
  }
  throw new PendleBuildError(
    'pendle.buildRedeem: expired-market redemption is not enabled yet because this surface only has the ' +
      'active-market catalog. Refusing to build signable calldata without verifying the market PT/underlying pair.'
  )
}

/** The sdk.defi.pendle namespace surface. */
export const pendle = {
  markets: pendleMarkets,
  market: pendleMarket,
  buildBuyPt,
  buildSellPt,
  buildRedeem,
  SUPPORTED_CHAINS: PENDLE_SUPPORTED_CHAINS,
  ROUTER_V4: PENDLE_ROUTER_V4,
} as const
