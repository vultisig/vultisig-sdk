/**
 * `sdk.defi.osmosis` — unsigned Osmosis Cosmos message builders.
 *
 * GAMM (Generalized AMM), Concentrated Liquidity (CL, Uniswap-v3-style), and
 * Superfluid staking. Every export BUILDS UNSIGNED proto3 messages only — pure
 * crypto, no signing, no broadcast, no network.
 *
 * Ported from the mcp-ts osmosis{Gamm,CL,Superfluid}Tools (10 tools); the
 * msg-encode side is hand-rolled on `cosmjs-types` BinaryWriter per the SDK's
 * lib-vs-hand-roll decision (no heavy `osmojs`).
 *
 * @example
 * ```ts
 * import { osmosis } from '@vultisig/sdk/tools/defi'
 * const msg = osmosis.buildSwapExactAmountIn({
 *   sender: 'osmo1...',
 *   routes: [{ poolId: '1', tokenOutDenom: 'uosmo' }],
 *   tokenIn: { denom: 'ibc/27394F...', amount: '1000000' },
 *   tokenOutMinAmount: '950000',
 * })
 * // msg.typeUrl === '/osmosis.gamm.v1beta1.MsgSwapExactAmountIn'
 * // osmosis.toAny(msg) -> Any bytes for a TxBody.messages entry
 * ```
 */
export * from './builders'
export type { OsmosisAffiliateConfig } from './types'
