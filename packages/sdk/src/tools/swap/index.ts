export type { FindSwapQuoteParams, SwapQuote } from './findSwapQuote'
export { findSwapQuote } from './findSwapQuote'
export type { NativeSwapMinAmountIn } from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
export {
  getNativeSwapMinAmountIn,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
} from '@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn'
export { getNativeSwapDecimals } from '@vultisig/core-chain/swap/native/utils/getNativeSwapDecimals'

// Astroport in-chain swap (Terra v2 / phoenix-1) — builds unsigned wasm_execute
export type { AstroportSwapResult, BuildAstroportSwapParams } from './astroport'
export {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} from './astroport'
