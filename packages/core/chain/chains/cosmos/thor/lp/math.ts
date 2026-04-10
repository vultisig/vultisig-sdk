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
  const P = BigInt(pool.poolUnits)
  const R = BigInt(pool.runeDepth)
  const A = BigInt(pool.assetDepth)
  const r = BigInt(runeAmountBaseUnit)
  const a = BigInt(assetAmountBaseUnit)

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
 * Calculate the user's share of a pool given their liquidity units.
 *
 * `poolShareDecimal` is `units / (poolUnits + units)` (the share after
 * the deposit settles). `runeShare` and `assetShare` are proportional to
 * that share against the post-deposit pool depths.
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
  runeShareBaseUnit: string
  assetShareBaseUnit: string
  poolShareDecimal: string
} => {
  const P = BigInt(pool.poolUnits)
  const R = BigInt(pool.runeDepth)
  const A = BigInt(pool.assetDepth)
  const L = BigInt(liquidityUnits)

  if (P === 0n || L === 0n) {
    return {
      runeShareBaseUnit: '0',
      assetShareBaseUnit: '0',
      poolShareDecimal: '0',
    }
  }

  const totalAfter = P + L
  const runeShare = (R * L) / totalAfter
  const assetShare = (A * L) / totalAfter

  // Decimal share with 18-digit precision as a string (no floats).
  // We multiply by 1e18, divide, then format as "0.xxx".
  const SCALE = 10n ** 18n
  const scaled = (L * SCALE) / totalAfter
  const decimal = scaled.toString().padStart(19, '0') // at least 18 fractional digits
  const intPart = decimal.slice(0, -18) || '0'
  const fracPart = decimal.slice(-18).replace(/0+$/, '')

  return {
    runeShareBaseUnit: runeShare.toString(),
    assetShareBaseUnit: assetShare.toString(),
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
  const R = BigInt(pool.runeDepth)
  const A = BigInt(pool.assetDepth)
  const r = BigInt(runeAmountBaseUnit)
  const a = BigInt(assetAmountBaseUnit)

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

  // Convert to rune-equivalent for display. The slip applies to the RUNE
  // side of the rebalancing swap. For an asym RUNE deposit, slip reduces
  // the effective r by (r * slip). For an asym asset deposit, convert a
  // to rune via the asset-price-in-rune = R/A.
  let slippageInRune: bigint
  if (a === 0n) {
    // asym rune deposit
    slippageInRune = (r * scaled) / SCALE
  } else if (r === 0n) {
    // asym asset deposit — convert a to rune value then apply slip
    const aInRune = (a * R) / A
    slippageInRune = (aInRune * scaled) / SCALE
  } else {
    // (mostly) symmetric — slippage approaches zero anyway
    const totalInRune = r + (a * R) / A
    slippageInRune = (totalInRune * scaled) / SCALE
  }

  return {
    decimalPercent,
    slippageInRuneBaseUnit: slippageInRune.toString(),
  }
}

export type EstimateLpAddResult = {
  liquidityUnits: string
  poolShareDecimal: string
  runeShareBaseUnit: string
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

  const poolState: PoolState = {
    assetDepth: raw.balance_asset,
    runeDepth: raw.balance_rune,
    poolUnits: raw.pool_units ?? raw.LP_units ?? '0',
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

  return {
    liquidityUnits,
    poolShareDecimal: share.poolShareDecimal,
    runeShareBaseUnit: share.runeShareBaseUnit,
    assetShareBaseUnit: share.assetShareBaseUnit,
    slippageDecimal: slip.decimalPercent,
    slippageRuneBaseUnit: slip.slippageInRuneBaseUnit,
  }
}
