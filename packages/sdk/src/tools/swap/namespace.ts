/**
 * Grouped `sdk.swap.*` namespace, matching the documented `sdk.swap.findSwapQuote`
 * shape (issue #1912 verification target).
 *
 * Deliberately excludes `./jupiter` (`buildJupiterSwapTx` statically pulls
 * `@solana/web3.js`, which reads `globalThis.Buffer` at module init — the same
 * Hermes-hostile pattern `platforms/react-native/index.ts` lazy-imports
 * `buildSplTransfer` to avoid) and `./skip` (Skip Go cross-chain route/tx
 * builder — not currently re-exported from the React Native entry and not yet
 * audited for the same class of eager chain-client imports). Both remain
 * reachable via their existing flat exports; this namespace object is built
 * from the shared `Vultisig` class, which also bundles for React Native, so it
 * only aggregates swap primitives already proven RN-safe as static imports.
 */
import { acrossQuote, acrossSupportedChains } from './acrossQuote'
import {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} from './astroport'
import { findSwapQuote } from './findSwapQuote'

export const swap = {
  findSwapQuote,
  acrossQuote,
  acrossSupportedChains,
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} as const

export type Swap = typeof swap
