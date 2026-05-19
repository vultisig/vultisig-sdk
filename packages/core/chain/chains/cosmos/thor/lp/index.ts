/**
 * THORChain liquidity-pool primitives.
 *
 * Pure-function memo + payload builders, chain-prefix mapping, paired-
 * address resolution, pool-math (slippage/units/share), and thin
 * Midgard / thornode fetchers. Used by `vultisig-mcp-ts` (MCP tools) and
 * by `vultiagent-poc` (hand-rolled signing until VA-133 lands).
 *
 * v2 surface (current):
 *   - asym RUNE-side add + remove with optional auto-pair (matches iOS /
 *     vultisig-windows extension behavior)
 *   - asset-side add with inbound / router / approval detection
 *   - LP math: liquidity units, pool share, slippage, one-shot estimator
 *   - position read-back: single pool + multi-pool
 *   - lockup awareness (mimir-driven)
 *   - halt / pause status per chain
 *
 * Deliberately excluded:
 *   - savers (deprecated on-chain 2025-01-04)
 *   - RUNEPool (separate product)
 *   - secured assets (handled by `@vultisig/rujira`)
 *   - affiliate on LP memos (matches iOS / extension native behavior)
 */
export type { AddLpMemoInput, RemoveLpMemoInput } from './memo'
export { addLpMemo, removeLpMemo } from './memo'
export type {
  BuildThorchainLpAddPayloadInput,
  BuildThorchainLpRemovePayloadInput,
  ThorchainLpAddPayload,
  ThorchainLpRemovePayload,
} from './payload'
export { buildThorchainLpAddPayload, buildThorchainLpRemovePayload } from './payload'
export type { GetThorchainPoolsOptions, ThorchainPoolSummary } from './pools'
export { assertValidPoolId, getThorchainPools, isValidPoolId, thorchainMidgardBaseUrl } from './pools'
export type { GetThorchainLpPositionInput } from './position'
export { getThorchainLpPosition, getThorchainLpPositionFromThornode } from './position'
export type { ThorchainLpPosition } from './types'
export { assertPoolDepositable, getThorchainMimir, poolPauseMimirKey } from './validation'

// v2 additions
export type { LpHaltStatus } from './halts'
export { getThorchainLpHaltStatus, getThorchainLpHaltStatusAll, getThorchainLpPoolPauseStatus } from './halts'
export type { LpWithdrawReadiness } from './lockup'
export { getLpWithdrawReadiness, getThorchainLpLockupSeconds, THORCHAIN_BLOCK_TIME_SECONDS } from './lockup'
export { chainPrefixToChain, chainToLpPrefix, lpChainMap } from './lpChainMap'
export type { EstimateLpAddResult, PoolState, SlippageResult } from './math'
export { estimateLpAdd, getLiquidityUnits, getLpAddSlippage, getPoolShare } from './math'
export type { VaultAddressMap } from './pairing'
export type { LpSide } from './pairing'
export { resolvePairedAddressForLpAdd } from './pairing'
export { getThorchainLpPositions } from './positions'
