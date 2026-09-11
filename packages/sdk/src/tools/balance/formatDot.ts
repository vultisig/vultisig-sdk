// 1 DOT = 1e10 Planck. Same on relay chain + Asset Hub.
export const DOT_DECIMALS = 10

/** Format a raw Planck u128 as a human DOT string, trimming trailing fractional zeros. */
export const formatDot = (rawPlanck: bigint): string => {
  const divisor = 10n ** BigInt(DOT_DECIMALS)
  const whole = rawPlanck / divisor
  const frac = rawPlanck % divisor
  if (frac === 0n) return whole.toString()
  return `${whole}.${frac.toString().padStart(DOT_DECIMALS, '0').replace(/0+$/, '')}`
}
