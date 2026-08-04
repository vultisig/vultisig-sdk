// Shared LiFi slippage-tier logic, extracted so the core `getLifiSwapQuote` AND its RN override
// (platforms/react-native/overrides/getLifiSwapQuote.ts — a SEPARATE build target that rollup
// redirects core's module to, see rollup.platforms.config.js) resolve slippage identically. The
// override cannot import from core's `getLifiSwapQuote` (that path redirects back to itself), so
// this sibling module is the single source of truth for the stable-pair set + the two tiers.

// For same-chain swaps, the slippage fraction is baked into the LiFi-prebuilt tx's `minAmountOut`
// floor at quote time (the underlying AMM reverts if simulation-time output drops below it). LiFi's
// default 0.5% is too tight for MPC-signed flows: the keysign ceremony adds 30-90s of drift between
// quote and broadcast.
// Production repro (2026-05-22): a SOL→USDC route failed simulation with Raydium AMM error 50
// (AmountExceedsMaximum / slippage exceeded) at 0.5%.
//
// Two tiers (vultisig-sdk#524):
// - stable pairs (USDC/USDT/DAI/...): 0.3% — well above typical concentrated-liquidity spread
//   (0.02-0.05%) but avoids the 1% MEV surface on tight-peg operations.
// - volatile pairs: 1% — covers the ceremony drift; typical realised slippage is <0.1%, so this is
//   a ceiling, not the expected hit.
//
// Cross-chain caveat (NeOMakinG #513): the source-chain bridge calldata may not enforce this against
// the final destination asset at all. EVM keysign construction therefore accepts only LI.FI selectors
// with a directly comparable final-output floor and rejects opaque bridge selectors.
export const DEFAULT_LIFI_SLIPPAGE_TOLERANCE = 0.01
export const STABLE_PAIR_LIFI_SLIPPAGE_TOLERANCE = 0.003

// Defensive combined affiliate + slippage ceiling (logged, never thrown): a high affiliateBps must
// not silently combine with slippage into a >3% effective cost without anyone noticing.
export const MAX_COMBINED_COST_BPS = 300

// Stable-pair detection: tickers that commonly trade within a tight peg. DAI is included because on
// most DEXs DAI/USDC depth is comparable to USDC/USDT and the 0.3% ceiling is still safe headroom.
export const STABLE_TICKERS: ReadonlySet<string> = new Set([
  'USDC',
  'USDT',
  'DAI',
  'BUSD',
  'TUSD',
  'FRAX',
  'USDP',
  'GUSD',
  'LUSD',
  'USDD',
  'FDUSD',
  'PYUSD',
])

const isStableTicker = (ticker: string | undefined): boolean =>
  ticker !== undefined && STABLE_TICKERS.has(ticker.toUpperCase())

export const isStablePair = (from: { ticker?: string }, to: { ticker?: string }): boolean =>
  isStableTicker(from.ticker) && isStableTicker(to.ticker)

/**
 * Resolve the LiFi slippage fraction: honor an explicit consumer override, else pick the tier by
 * pair type. `slippageOverride` is a fraction (0.01 = 1%). Same-chain EVM calldata binds this to its
 * final `minAmountOut`; opaque cross-chain selectors are rejected before keysign construction.
 */
export const resolveLifiSlippage = ({
  slippageOverride,
  from,
  to,
}: {
  slippageOverride: number | undefined
  from: { ticker?: string }
  to: { ticker?: string }
}): number =>
  slippageOverride ?? (isStablePair(from, to) ? STABLE_PAIR_LIFI_SLIPPAGE_TOLERANCE : DEFAULT_LIFI_SLIPPAGE_TOLERANCE)
