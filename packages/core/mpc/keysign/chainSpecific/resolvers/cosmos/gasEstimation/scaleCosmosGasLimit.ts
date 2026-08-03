/**
 * Safety multiplier applied to the node's reported `gas_used`, expressed as a
 * rational `numerator/denominator` so the scaling stays exact integer math (the
 * gas limit is part of the SignDoc, so a float here would risk cross-device
 * divergence). `13/10` = 1.3×, matching the cosmjs default multiplier and iOS
 * (`CosmosGasEstimator.safetyMultiplier`). The node's `gas_used` is a tight
 * lower bound; padding keeps the tx from running out of gas on-chain due to
 * execution nondeterminism.
 */
export const cosmosGasSafetyMultiplier = { numerator: 13n, denominator: 10n } as const

/**
 * `ceil(gasUsed × 1.3)` in exact integer arithmetic.
 *
 * Ceiling (not floor/round) so the padded limit never lands below `gas_used`,
 * and so it matches iOS's `NSDecimalRound(.up)` byte-for-byte.
 */
export const scaleCosmosGasLimit = (gasUsed: bigint): bigint => {
  const { numerator, denominator } = cosmosGasSafetyMultiplier
  return (gasUsed * numerator + denominator - 1n) / denominator
}
