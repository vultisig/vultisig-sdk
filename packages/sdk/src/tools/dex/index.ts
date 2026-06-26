// DEX primitives — pure-crypto / read-only math + on-chain reads. No signing,
// no broadcast. Quote/inspect surfaces only.
export * as uniswap from './uniswap'
// On-chain DEX quote primitives (read-only — no calldata, no signing).
export type { BalancerPoolState, BalancerQuote, BalancerQuoteParams, BalancerSwapKind } from './balancerQuote'
export { balancerQuote } from './balancerQuote'
export type { UniV2Deployment } from './uniswapV2Addresses'
export { supportedUniV2Chains, UNI_V2_DEPLOYMENTS } from './uniswapV2Addresses'
export type { UniswapV2Quote, UniswapV2QuoteParams } from './uniswapV2Quote'
export { getAmountOut, uniswapV2Quote } from './uniswapV2Quote'
