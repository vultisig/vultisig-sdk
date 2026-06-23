/**
 * `sdk.defi.*` — DeFi protocol primitives.
 *
 * Each protocol lives under `sdk.defi.<protocol>` and BUILDS UNSIGNED calldata /
 * msgs ONLY (never signs, never broadcasts). Part of the DeFi consolidation that
 * ports the mcp-ts `build_*` tools into the multi-consumer SDK.
 */
import * as glif from './glif'

export { glif }

export type {
  BuildGlifRedeemParams,
  BuildGlifRedeemResult,
  BuildGlifStakeParams,
  BuildGlifStakeResult,
  GlifUnsignedTx,
} from './glif'
