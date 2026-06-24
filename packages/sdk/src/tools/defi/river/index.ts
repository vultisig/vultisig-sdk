/**
 * `sdk.defi.river` — River Omni-CDP (Satoshi) unsigned-tx builders.
 *
 * Builds UNSIGNED EVM calldata only (delegate approval, open trove, close
 * trove). Never signs, never broadcasts. Hand-rolled viem against River's
 * public contract ABIs (no River SDK exists that passes the RN/Hermes filter).
 *
 * Any affiliate/fee param is INJECTABLE and defaults neutral/off.
 */

export type { RiverChain, RiverChainConfig } from './constants'
export {
  isRiverChain,
  RIVER_CHAIN_CONFIG,
  RIVER_DEFAULT_MAX_FEE_BPS,
  RIVER_SUPPORTED_CHAINS,
  RIVER_TROVE_STATUS_NAMES,
  riverStatusName,
} from './constants'
export type {
  BuildRiverCloseTroveParams,
  BuildRiverDelegateApprovalParams,
  BuildRiverOpenTroveParams,
  RiverAffiliateConfig,
  RiverCloseTroveMeta,
  RiverDelegateApprovalMeta,
  RiverMarket,
  RiverOpenTroveMeta,
  RiverTxBuild,
  RiverUnsignedTx,
} from './river'
export {
  buildRiverCloseTrove,
  buildRiverDelegateApproval,
  buildRiverOpenTrove,
  describeRiverMarket,
  findRiverInsertHints,
  formatRiverPercentWad,
} from './river'

import {
  buildRiverCloseTrove,
  buildRiverDelegateApproval,
  buildRiverOpenTrove,
  describeRiverMarket,
  findRiverInsertHints,
} from './river'

/**
 * Namespaced surface: `sdk.defi.river.*`.
 *
 * Exposed both as a grouped object (for `sdk.defi.river` ergonomics) and as
 * individual named exports above (for tree-shakeable direct imports).
 */
export const river = {
  buildDelegateApproval: buildRiverDelegateApproval,
  buildOpenTrove: buildRiverOpenTrove,
  buildCloseTrove: buildRiverCloseTrove,
  describeMarket: describeRiverMarket,
  findInsertHints: findRiverInsertHints,
} as const
