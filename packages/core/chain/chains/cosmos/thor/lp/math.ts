import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { assertValidPoolId } from './pools'

/**
 * Minimal pool state required for LP math. All values are base-unit
 * strings at THORChain's fixed 1e8 precision — these are the shapes
 * returned by thornode `/thorchain/pool/{asset}` (`balance_asset`,
 * `balance_rune`, `pool_units`).
 */
export type PoolState = {
  assetDepth: string
  runeDepth: string
  poolUnits: string
}

/**
 * Assert a numeric input is a non-negative base-unit integer string.
 *
 * Public math helpers consume untrusted strings (LLM tool args, API
 * responses). Raw `BigInt('abc')` throws `SyntaxError: Cannot convert
 * abc to a BigInt`, which is an unhelpful error for callers and hides
 * the field name. This validator produces stable SDK-level errors
 * instead.
 */
const assertBaseUnitString = (value: string, fieldName: string): bigint => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      `${fieldName} must be a non-empty base-unit string, got ${typeof value === 'string' ? JSON.stringify(value) : typeof value}`
    )
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(
      `${fieldName} must be a non-negative integer base-unit string, got ${JSON.stringify(value)}`
    )
  }
  return BigInt(value)
}

/**
 * Calculate the liquidity units earned for a deposit.
 *
 * Formula: `units = P * (R*a + r*A) / (2 * R * A)`
 *
 *   P = current pool units
 *   r = RUNE deposited (base units)
 *   a = asset deposited (base units)
 *   R = current pool RUNE depth
 *   A = current pool asset depth
 *
 * Source: docs.thorchain.org continuous-liquidity-pools.md and the
 * THORChain dev handbook. Implemented from the canonical formula, not
 * copied from any third-party codebase. For an asymmetric deposit either
 * `r` or `a` is zero — the formula still holds (the internal 50/50
 * rebalancing happens on-chain and is reflected in the returned units via
 * the pool's existing depth ratio).
 *
 * All inputs / outputs are in 1e8 base units. Returns a non-negative
 * BigInt-safe integer string.
 */
export const getLiquidityUnits = ({
  pool,
  assetAmountBaseUnit,
  runeAmountBaseUnit,
}: {
  pool: PoolState
  assetAmountBaseUnit: string
  runeAmountBaseUnit: string
}): string => {
  const P = assertBaseUnitString(pool.poolUnits, 'pool.poolUnits')
  const R = assertBaseUnitString(pool.runeDepth, 'pool.runeDepth')
  const A = assertBaseUnitString(pool.assetDepth, 'pool.assetDepth')
  const r = assertBaseUnitString(runeAmountBaseUnit, 'runeAmountBaseUnit')
  const a = assertBaseUnitString(assetAmountBaseUnit, 'assetAmountBaseUnit')

  if (R === 0n || A === 0n || P === 0n) {
    // Empty / just-initialized pool — the first-deposit case is handled
    // differently on-chain (the depositor mints the full initial unit
    // supply). We can't model that here without knowing the genesis
    // unit scale, so return 0 and let the caller decide what to do.
    return '0'
  }

  const numerator = P * (R * a + r * A)
  const denominator = 2n * R * A
  return (numerator / denominator).toString()
}

/**
 * Calculate the user's fractional share of a pool AFTER a deposit settles.
 *
 * Returns only the decimal share (`units / (poolUnits + units)`). The
 * rune/asset base-unit shares are NOT computed here because the correct
 * values depend on the post-deposit pool depths, which this helper does
 * not take as inputs. For those values, use `estimateLpAdd` which has
 * the full pool state and deposit amounts.
 *
 * For display only — the on-chain accounting uses the units directly.
 */
export const getPoolShare = ({
  pool,
  liquidityUnits,
}: {
  pool: PoolState
  liquidityUnits: string
}): {
  poolShareDecimal: string
} => {
  const P = assertBaseUnitString(pool.poolUnits, 'pool.poolUnits')
  const L = assertBaseUnitString(liquidityUnits, 'liquidityUnits')

  if (P === 0n || L === 0n) {
    return { poolShareDecimal: '0' }
  }

  const totalAfter = P + L

  // Decimal share with 18-digit precision as a string (no floats).
  // We multiply by 1e18, divide, then format as "0.xxx".
  const SCALE = 10n ** 18n
  const scaled = (L * SCALE) / totalAfter
  const decimal = scaled.toString().padStart(19, '0') // at least 18 fractional digits
  const intPart = decimal.slice(0, -18) || '0'
  const fracPart = decimal.slice(-18).replace(/0+$/, '')

  return {
    poolShareDecimal: fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart,
  }
}

export type SlippageResult = {
  /**
   * Slippage as a decimal string, e.g. `"0.0032"` = 0.32%. Always
   * non-negative. Zero for symmetric deposits (balanced r/a against R/A).
   */
  decimalPercent: string
  /**
   * Slippage expressed in RUNE base units, for display. For asym-asset
   * deposits this is the RUNE-equivalent of the lost value.
   */
  slippageInRuneBaseUnit: string
}

/**
 * Calculate slippage for an LP add.
 *
 * Formula: `slip = |R*a - A*r| / (A*r + R*A)`
 *
 * This is the asym-rebalancing slip cost: when only one side is deposited,
 * THORChain internally performs a 50/50 swap to balance the pool, and
 * that swap incurs a slip cost proportional to how imbalanced the input
 * is against the existing depth.
 *
 * For symmetric deposits (r/a ratio matches R/A), the numerator is zero
 * and the slippage is exactly zero.
 *
 * Source: derived from the THORChain asymmetric-deposit-as-swap
 * documentation. Cross-checked against the formula used by multiple
 * independent implementations (iOS / extension don't compute this in
 * their UI — they leave it to the chain).
 */
export const getLpAddSlippage = ({
  pool,
  assetAmountBaseUnit,
  runeAmountBaseUnit,
}: {
  pool: PoolState
  assetAmountBaseUnit: string
  runeAmountBaseUnit: string
}): SlippageResult => {
  const R = assertBaseUnitString(pool.runeDepth, 'pool.runeDepth')
  const A = assertBaseUnitString(pool.assetDepth, 'pool.assetDepth')
  const r = assertBaseUnitString(runeAmountBaseUnit, 'runeAmountBaseUnit')
  const a = assertBaseUnitString(assetAmountBaseUnit, 'assetAmountBaseUnit')

  if (R === 0n || A === 0n) {
    return { decimalPercent: '0', slippageInRuneBaseUnit: '0' }
  }

  // |R*a - A*r| / (A*r + R*A)
  const ra = R * a
  const ar = A * r
  const numerator = ra > ar ? ra - ar : ar - ra
  const denominator = A * r + R * A

  if (denominator === 0n) {
    return { decimalPercent: '0', slippageInRuneBaseUnit: '0' }
  }

  // Express as decimal with 18-digit precision
  const SCALE = 10n ** 18n
  const scaled = (numerator * SCALE) / denominator

  const decimal = scaled.toString().padStart(19, '0')
  const intPart = decimal.slice(0, -18) || '0'
  const fracPart = decimal.slice(-18).replace(/0+$/, '')
  const decimalPercent =
    fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart

  // Convert to rune-equivalent for display. The slip applies only to the
  // imbalanced portion of the deposit — the part that has to be swapped
  // internally to balance the pool. We compute the imbalance in rune
  // terms: |R*a - A*r| / (2*A), then apply the slip fraction to it.
  //
  // For pure asym RUNE (a=0): imbalance = R*0 - A*r divided by 2*A, abs
  //   → r/2 (half the deposit gets swapped) → slippageInRune ≈ (r/2) * slip
  // For pure asym asset (r=0): imbalance = (R*a) / (2*A), the rune-value
  //   of half the deposit → slippageInRune ≈ (a*R / (2*A)) * slip
  // For balanced deposit: imbalance = 0 → slippageInRune = 0
  //
  // This is a heuristic display value, not an exact chain computation.
  // It under/overstates real on-chain slip by a constant factor in some
  // regimes but is directionally correct and never overstates by orders
  // of magnitude the way "slip * total deposit value" did.
  const imbalanceNumerator = ra > ar ? ra - ar : ar - ra
  const imbalanceInRune = A === 0n ? 0n : imbalanceNumerator / (2n * A)
  const slippageInRune = (imbalanceInRune * scaled) / SCALE

  return {
    decimalPercent,
    slippageInRuneBaseUnit: slippageInRune.toString(),
  }
}

export type EstimateLpAddResult = {
  liquidityUnits: string
  poolShareDecimal: string
  /**
   * Estimated rune-denominated value of the user's pool share, using
   * post-deposit (pre-internal-swap) pool depths. This is the amount
   * they could expect to reclaim on a full withdraw if nothing else
   * changed.
   */
  runeShareBaseUnit: string
  /** Estimated asset-denominated value of the user's pool share. */
  assetShareBaseUnit: string
  slippageDecimal: string
  slippageRuneBaseUnit: string
}

type ThornodePoolRaw = {
  balance_asset?: string
  balance_rune?: string
  pool_units?: string
  LP_units?: string
}

/**
 * One-shot estimator that chains pool-state fetch + the three math
 * helpers. Returns everything a UI needs to surface a quote before the
 * user signs.
 *
 * Fetches from thornode `/thorchain/pool/{asset}`. Injectable
 * `fetchImpl` for tests.
 */
export const estimateLpAdd = async ({
  pool,
  assetAmountBaseUnit,
  runeAmountBaseUnit,
  thornodeBaseUrl,
}: {
  pool: string
  assetAmountBaseUnit: string
  runeAmountBaseUnit: string
  /**
   * Override for the thornode base URL. Defaults to the mainnet
   * `thornode.ninerealms.com` used by the rest of the lp module.
   */
  thornodeBaseUrl?: string
}): Promise<EstimateLpAddResult> => {
  assertValidPoolId(pool)
  const base = thornodeBaseUrl ?? 'https://thornode.ninerealms.com'
  const url = `${base}/thorchain/pool/${encodeURIComponent(pool)}`
  const raw = await queryUrl<ThornodePoolRaw>(url)

  if (
    !raw ||
    typeof raw !== 'object' ||
    typeof raw.balance_asset !== 'string' ||
    typeof raw.balance_rune !== 'string'
  ) {
    throw new Error(
      `estimateLpAdd: pool ${pool} response from ${url} missing balance fields`
    )
  }
  const poolUnitsRaw = raw.pool_units ?? raw.LP_units
  if (typeof poolUnitsRaw !== 'string' || poolUnitsRaw.length === 0) {
    throw new Error(
      `estimateLpAdd: pool ${pool} response from ${url} missing pool_units / LP_units`
    )
  }

  const poolState: PoolState = {
    assetDepth: raw.balance_asset,
    runeDepth: raw.balance_rune,
    poolUnits: poolUnitsRaw,
  }

  const liquidityUnits = getLiquidityUnits({
    pool: poolState,
    assetAmountBaseUnit,
    runeAmountBaseUnit,
  })

  const share = getPoolShare({
    pool: poolState,
    liquidityUnits,
  })

  const slip = getLpAddSlippage({
    pool: poolState,
    assetAmountBaseUnit,
    runeAmountBaseUnit,
  })

  // Compute post-deposit base-unit shares from the caller's deposit
  // amounts. This is the correct frame for display ("you'll own X RUNE +
  // Y asset's worth"). Uses post-deposit depths R+r and A+a, which is
  // the pre-internal-swap state — close enough for display purposes and
  // doesn't require simulating the chain's internal rebalancing swap.
  const R = BigInt(poolState.runeDepth)
  const A = BigInt(poolState.assetDepth)
  const P = BigInt(poolState.poolUnits)
  const r = BigInt(runeAmountBaseUnit)
  const a = BigInt(assetAmountBaseUnit)
  const L = BigInt(liquidityUnits)
  const totalAfter = P + L
  const runeDepthAfter = R + r
  const assetDepthAfter = A + a
  const runeShareBaseUnit =
    totalAfter === 0n ? '0' : ((runeDepthAfter * L) / totalAfter).toString()
  const assetShareBaseUnit =
    totalAfter === 0n ? '0' : ((assetDepthAfter * L) / totalAfter).toString()

  return {
    liquidityUnits,
    poolShareDecimal: share.poolShareDecimal,
    runeShareBaseUnit,
    assetShareBaseUnit,
    slippageDecimal: slip.decimalPercent,
    slippageRuneBaseUnit: slip.slippageInRuneBaseUnit,
  }
}
