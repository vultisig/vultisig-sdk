/**
 * THORChain liquidity-pool primitives.
 *
 * Pure-function memo + payload builders alongside thin Midgard / thornode
 * fetchers. Used by `vultisig-mcp-ts` (which exposes them as MCP tools) and
 * eventually by `vultiagent-poc` once the SDK migration (VA-133) lands.
 *
 * v1 surface is intentionally narrow: asymmetric RUNE-side adds and
 * removes only. Asset-side adds (BTC/ETH/etc → inbound vault) and explicit
 * symmetric pairing are deferred until the end-to-end chat flow has shipped.
 */
export {
  VULTISIG_AFFILIATE_LP_BPS,
  VULTISIG_AFFILIATE_NAME,
} from './affiliate'
export type { AddLpMemoInput, RemoveLpMemoInput } from './memo'
export { addLpMemo, removeLpMemo } from './memo'
export type {
  BuildThorchainLpAddPayloadInput,
  BuildThorchainLpRemovePayloadInput,
  ThorchainLpAddPayload,
  ThorchainLpRemovePayload,
} from './payload'
export {
  buildThorchainLpAddPayload,
  buildThorchainLpRemovePayload,
} from './payload'
export type {
  GetThorchainPoolsOptions,
  ThorchainPoolSummary,
} from './pools'
export { getThorchainPools, THORCHAIN_MIDGARD_BASE_URL } from './pools'
export type {
  GetThorchainLpPositionInput,
  ThorchainLpPosition,
} from './position'
export { getThorchainLpPosition } from './position'
export { assertPoolDepositable } from './validation'
