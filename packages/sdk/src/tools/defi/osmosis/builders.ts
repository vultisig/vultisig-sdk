/**
 * Osmosis DeFi message builders — `sdk.defi.osmosis.*`.
 *
 * Each builder validates its inputs (fund-safety first) and returns an
 * {@link EncodedMsg} — a `{ typeUrl, value }` pair where `value` is the proto3-
 * encoded message body. The result drops straight into a Cosmos `TxBody.messages`
 * entry (wrap with {@link toAny} for the raw Any bytes a SignDirect body needs).
 *
 * These builders BUILD UNSIGNED messages ONLY. They never sign, never broadcast,
 * never touch the network. Encoding is pure + synchronous.
 *
 * Covered surfaces (10, mirroring the mcp-ts osmosis tools):
 *   - GAMM:        joinPool, exitPool, swapExactAmountIn
 *   - CL:          createPosition, withdrawPosition, collectSpreadRewards, collectIncentives
 *   - Superfluid:  delegate, undelegate
 */
import {
  encodeMsgCollectIncentives,
  encodeMsgCollectSpreadRewards,
  encodeMsgCreatePosition,
  encodeMsgExitPool,
  encodeMsgJoinPool,
  encodeMsgSuperfluidDelegate,
  encodeMsgSuperfluidUndelegate,
  encodeMsgSwapExactAmountIn,
  encodeMsgWithdrawPosition,
} from './proto'
import type { Coin, EncodedMsg } from './types'
import {
  OSMOSIS_BECH32_PREFIX,
  validateBech32,
  validateCoins,
  validateNonNegativeInt,
  validateOsmoAddress,
  validateOsmoValidator,
  validatePositiveDecimal,
  validatePositiveInt,
  validateSignedInt,
  validateUint64Id,
} from './validation'

export { toAny } from './proto'
export type { Coin, EncodedMsg } from './types'
export { OSMOSIS_BECH32_PREFIX, OSMOSIS_CHAIN_ID, OSMOSIS_VALIDATOR_BECH32_PREFIX } from './validation'

// ===========================================================================
// GAMM
// ===========================================================================

export type JoinPoolParams = {
  sender: string
  poolId: string
  /** Minimum gamm/pool/N shares to receive (base units, 18 decimals). */
  shareOutAmount: string
  /** Max tokens to deposit (both pool assets), base units. */
  tokenInMaxs: Coin[]
}

/** Build an unsigned `MsgJoinPool` (multi-asset GAMM join). */
export function buildJoinPool(params: JoinPoolParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const poolId = validateUint64Id(params.poolId, 'poolId')
  const shareOutAmount = validatePositiveInt(params.shareOutAmount, 'shareOutAmount')
  const tokenInMaxs = validateCoins(params.tokenInMaxs, 'tokenInMaxs')
  return encodeMsgJoinPool({ sender, poolId, shareOutAmount, tokenInMaxs })
}

export type ExitPoolParams = {
  sender: string
  poolId: string
  /** gamm/pool/N shares to burn (base units, 18 decimals). */
  shareInAmount: string
  /** Minimum tokens to receive per asset (base units; "0" to accept any). */
  tokenOutMins: Coin[]
}

/** Build an unsigned `MsgExitPool` (GAMM exit → underlying tokens). */
export function buildExitPool(params: ExitPoolParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const poolId = validateUint64Id(params.poolId, 'poolId')
  const shareInAmount = validatePositiveInt(params.shareInAmount, 'shareInAmount')
  const tokenOutMins = validateCoins(params.tokenOutMins, 'tokenOutMins', { allowZero: true })
  return encodeMsgExitPool({ sender, poolId, shareInAmount, tokenOutMins })
}

export type SwapExactAmountInParams = {
  sender: string
  /** Ordered multi-hop route. Each hop: pool to swap through + the denom to receive. */
  routes: { poolId: string; tokenOutDenom: string }[]
  /** Exact input coin (base units). */
  tokenIn: Coin
  /** Minimum output (base units) — slippage floor. */
  tokenOutMinAmount: string
}

/** Build an unsigned `MsgSwapExactAmountIn` (GAMM / poolmanager swap). */
export function buildSwapExactAmountIn(params: SwapExactAmountInParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  if (!Array.isArray(params.routes) || params.routes.length === 0) {
    throw new Error('routes must be a non-empty array of {poolId, tokenOutDenom}')
  }
  const routes = params.routes.map((r, i) => ({
    poolId: validateUint64Id(r.poolId, `routes[${i}].poolId`),
    tokenOutDenom: ((): string => {
      const d = (r.tokenOutDenom ?? '').trim()
      if (!d) throw new Error(`routes[${i}].tokenOutDenom must be a non-empty denom`)
      return d
    })(),
  }))
  const [tokenIn] = validateCoins([params.tokenIn], 'tokenIn')
  const tokenOutMinAmount = validateNonNegativeInt(params.tokenOutMinAmount, 'tokenOutMinAmount')
  return encodeMsgSwapExactAmountIn({ sender, routes, tokenIn, tokenOutMinAmount })
}

// ===========================================================================
// Concentrated Liquidity
// ===========================================================================

export type CreatePositionParams = {
  sender: string
  poolId: string
  /** Lower price tick (signed, multiple of pool tick_spacing). */
  lowerTick: string
  /** Upper price tick (signed, multiple of pool tick_spacing). */
  upperTick: string
  /** Tokens to provide within the range (base units). */
  tokensProvided: Coin[]
  /** Slippage floor for token0 (base units). Default "0". */
  tokenMinAmount0?: string
  /** Slippage floor for token1 (base units). Default "0". */
  tokenMinAmount1?: string
}

/** Build an unsigned `MsgCreatePosition` (open a CL position over a tick range). */
export function buildCreatePosition(params: CreatePositionParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const poolId = validateUint64Id(params.poolId, 'poolId')
  const lowerTick = validateSignedInt(params.lowerTick, 'lowerTick')
  const upperTick = validateSignedInt(params.upperTick, 'upperTick')
  if (BigInt(lowerTick) >= BigInt(upperTick)) {
    throw new Error(`lowerTick (${lowerTick}) must be less than upperTick (${upperTick})`)
  }
  const tokensProvided = validateCoins(params.tokensProvided, 'tokensProvided')
  const tokenMinAmount0 = validateNonNegativeInt(params.tokenMinAmount0 ?? '0', 'tokenMinAmount0')
  const tokenMinAmount1 = validateNonNegativeInt(params.tokenMinAmount1 ?? '0', 'tokenMinAmount1')
  return encodeMsgCreatePosition({
    poolId,
    sender,
    lowerTick,
    upperTick,
    tokensProvided,
    tokenMinAmount0,
    tokenMinAmount1,
  })
}

export type WithdrawPositionParams = {
  sender: string
  positionId: string
  /** Liquidity to withdraw (decimal Dec string). */
  liquidityAmount: string
}

/** Build an unsigned `MsgWithdrawPosition` (close / reduce a CL position). */
export function buildWithdrawPosition(params: WithdrawPositionParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const positionId = validateUint64Id(params.positionId, 'positionId')
  const liquidityAmount = validatePositiveDecimal(params.liquidityAmount, 'liquidityAmount')
  return encodeMsgWithdrawPosition({ positionId, sender, liquidityAmount })
}

export type CollectRewardsParams = {
  sender: string
  /** One or more CL position IDs. */
  positionIds: string[]
}

function normalizePositionIds(positionIds: string[]): string[] {
  if (!Array.isArray(positionIds) || positionIds.length === 0) {
    throw new Error('positionIds must be a non-empty array of position ID strings')
  }
  const validated = positionIds.map((id, i) => validateUint64Id(id, `positionIds[${i}]`))
  // Dedupe + numeric sort for determinism.
  return Array.from(new Set(validated)).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
}

/** Build an unsigned `MsgCollectSpreadRewards` (harvest CL trading fees). */
export function buildCollectSpreadRewards(params: CollectRewardsParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const positionIds = normalizePositionIds(params.positionIds)
  return encodeMsgCollectSpreadRewards({ positionIds, sender })
}

/** Build an unsigned `MsgCollectIncentives` (harvest CL incentive rewards). */
export function buildCollectIncentives(params: CollectRewardsParams): EncodedMsg {
  const sender = validateOsmoAddress(params.sender, 'sender')
  const positionIds = normalizePositionIds(params.positionIds)
  return encodeMsgCollectIncentives({ positionIds, sender })
}

// ===========================================================================
// Superfluid
// ===========================================================================

export type SuperfluidDelegateParams = {
  sender: string
  /** Lock ID of the bonded LP shares (from the lockup module). */
  lockId: string
  /** Validator operator address (osmovaloper1...). */
  valAddr: string
}

/** Build an unsigned `MsgSuperfluidDelegate` (superfluid-stake a bonded LP lock). */
export function buildSuperfluidDelegate(params: SuperfluidDelegateParams): EncodedMsg {
  const sender = validateBech32(params.sender, 'sender', OSMOSIS_BECH32_PREFIX)
  const lockId = validateUint64Id(params.lockId, 'lockId')
  const valAddr = validateOsmoValidator(params.valAddr, 'valAddr')
  return encodeMsgSuperfluidDelegate({ sender, lockId, valAddr })
}

export type SuperfluidUndelegateParams = {
  sender: string
  lockId: string
}

/** Build an unsigned `MsgSuperfluidUndelegate` (remove superfluid delegation). */
export function buildSuperfluidUndelegate(params: SuperfluidUndelegateParams): EncodedMsg {
  const sender = validateBech32(params.sender, 'sender', OSMOSIS_BECH32_PREFIX)
  const lockId = validateUint64Id(params.lockId, 'lockId')
  return encodeMsgSuperfluidUndelegate({ sender, lockId })
}
