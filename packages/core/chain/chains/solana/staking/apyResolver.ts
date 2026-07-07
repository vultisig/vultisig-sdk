import { SolanaValidator } from './models/validator'

/**
 * Resolves a per-validator staking APY (as a fraction, e.g. 0.067 for 6.7%) for
 * the Solana DeFi stake rows. Two sources, in order:
 *
 *   1. Stakewiz `apy_estimate` passthrough — the metadata provider's estimate is
 *      the preferred, network-measured value (already commission-net).
 *   2. On-chain fallback — derive APR from the network inflation rate and the
 *      fraction of supply staked, net of the validator's commission, then
 *      compound over the epochs-per-year to an APY:
 *        APR = (inflation / fractionStaked) × (1 − commission)
 *        APY = (1 + APR / N)^N − 1   (N = epochs per year)
 *
 * Returns `undefined` when neither source yields a positive value, and the view
 * hides the APY row.
 *
 * Port of iOS `SolanaStakingAPYResolver`.
 */

/** Mainnet epoch is ~2 days, so ~182 epochs per year. */
const epochsPerYear = 182

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * `APY = (1 + APR/N)^N − 1` where
 * `APR = (inflation / fractionStaked) × (1 − commission)`. Returns `undefined`
 * when any input is missing or collapses the result to zero.
 */
export const onChainApy = ({
  inflationRate,
  commission,
  totalActivatedStake,
  totalSupplyLamports,
}: {
  inflationRate: number | undefined
  commission: number
  totalActivatedStake: number
  totalSupplyLamports: number | undefined
}): number | undefined => {
  if (
    inflationRate === undefined ||
    inflationRate <= 0 ||
    totalSupplyLamports === undefined ||
    totalSupplyLamports <= 0 ||
    totalActivatedStake <= 0
  ) {
    return undefined
  }

  const fractionStaked = totalActivatedStake / totalSupplyLamports
  if (fractionStaked <= 0) {
    return undefined
  }

  const commissionFraction = clamp01(commission / 100)
  const apr = (inflationRate / fractionStaked) * (1 - commissionFraction)
  if (apr <= 0) {
    return undefined
  }

  const apy = (1 + apr / epochsPerYear) ** epochsPerYear - 1
  return Number.isFinite(apy) && apy > 0 ? apy : undefined
}

/**
 * Resolves the APY fraction for `validator`. The Stakewiz `apyEstimate` is the
 * preferred value when present; otherwise the on-chain fallback derives it from
 * `inflationRate`, `totalSupplyLamports`, and `totalActivatedStake`.
 *
 * `totalActivatedStake` is the NETWORK-wide total activated stake (the
 * `fractionStaked` denominator numerator), NOT this validator's own
 * `activatedStake` — feeding a single validator's stake would collapse
 * `fractionStaked` and explode the APY. Compute it once from the full validator
 * set via `networkActivatedStake` and pass it in (mirrors iOS, which threads the
 * summed validator-set stake through as `totalActivatedStake`).
 */
export const resolveValidatorApy = ({
  validator,
  inflationRate,
  totalSupplyLamports,
  totalActivatedStake,
}: {
  validator: SolanaValidator
  inflationRate: number | undefined
  totalSupplyLamports: number | undefined
  totalActivatedStake: number
}): number | undefined => {
  const metadataApy = validator.metadata.apyEstimate
  if (metadataApy !== undefined && metadataApy > 0) {
    return metadataApy
  }
  return onChainApy({
    inflationRate,
    commission: validator.commission,
    totalActivatedStake,
    totalSupplyLamports,
  })
}
