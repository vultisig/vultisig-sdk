import { ThorchainInboundAddress } from '../../chains/cosmos/thor/getThorchainInboundAddress'

/**
 * THORChain publishes `dust_threshold` in its own 1e8 fixed point, regardless
 * of the source chain's native precision.
 */
const thorchainFixedPointDecimals = 8

/**
 * Safety multiple over the larger floor.
 *
 * A cancel sitting exactly ON a threshold is a coin flip: THORNode's own
 * comparisons are not uniformly `>=`, and the published threshold can move
 * between the inbound fetch and the transaction landing. Doubling removes both
 * without a magic absolute floor that would be wrong on some chain's units
 * (10,000 is dust on an 18-decimal chain and real money on an 8-decimal one).
 */
const dustSafetyMultiple = 2n

/**
 * Hard ceiling as a multiple of the published threshold.
 *
 * `dust_threshold` is a REMOTE value that directly decides how much of the
 * user's money is irreversibly donated — there is no refund path for anything
 * attached to an `m=<`. A wrong or hostile value would otherwise be honoured
 * verbatim and then doubled. Every other floor here is a lower bound; this is
 * the only upper one.
 */
const dustCeilingMultiple = 100n

export const limitSwapCancelDustErrors = [
  'thresholdUnavailable',
  'malformedThreshold',
  'unusablePrecision',
  'belowObservableMinimum',
  'exceedsCeiling',
] as const

export type LimitSwapCancelDustErrorReason = (typeof limitSwapCancelDustErrors)[number]

export class LimitSwapCancelDustError extends Error {
  readonly reason: LimitSwapCancelDustErrorReason

  constructor(reason: LimitSwapCancelDustErrorReason, message: string) {
    super(message)
    this.reason = reason
    this.name = 'LimitSwapCancelDustError'
  }
}

type GetLimitSwapCancelDustInput = {
  /** The live inbound row for the source chain. */
  inbound: Pick<ThorchainInboundAddress, 'chain' | 'dust_threshold'>
  /** The source coin's own precision — 18 for an EVM gas asset, 8 for a UTXO one. */
  decimals: number
}

/**
 * How much to attach to a cancel sent FROM an L1 chain, in the source coin's
 * smallest units.
 *
 * A cancel carries no value; the amount exists solely so Bifrost observes the
 * transaction at all. Both failure modes are silent, which is why every branch
 * here throws rather than defaulting:
 *
 * - Under-funded, and Bifrost drops it before it becomes a `MsgObservedTxIn` —
 *   the transaction confirms, the fee is spent, nothing is cancelled.
 * - Over-funded, and the excess is irreversibly donated.
 *
 * The conversion is the part that has actually gone wrong in practice: a cancel
 * was once signed for **2000 wei** — THORChain's 1e8-unit threshold used
 * verbatim as an 18-decimal chain's smallest unit — which `ConvertAmount`
 * truncates to zero. So the threshold is rescaled from 1e8 into the coin's own
 * precision, and a result that rounds away is refused rather than nudged up to
 * the bare observable minimum, which would be the same silent failure one order
 * of magnitude higher.
 */
export const getLimitSwapCancelDust = ({ inbound, decimals }: GetLimitSwapCancelDustInput): bigint => {
  const { chain, dust_threshold: threshold } = inbound

  if (!threshold?.trim()) {
    throw new LimitSwapCancelDustError(
      'thresholdUnavailable',
      `cancel dust: ${chain} inbound carries no dust_threshold, so the minimum Bifrost will observe is unknown`
    )
  }
  if (!/^\d+$/.test(threshold.trim())) {
    throw new LimitSwapCancelDustError(
      'malformedThreshold',
      `cancel dust: ${chain} dust_threshold is not an integer: ${JSON.stringify(threshold)}`
    )
  }
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new LimitSwapCancelDustError(
      'unusablePrecision',
      `cancel dust: ${chain} source coin declares an unusable precision (${decimals})`
    )
  }

  const thresholdIn1e8 = BigInt(threshold.trim())

  // Rescale from THORChain's 1e8 into the coin's own precision. Integer-only,
  // in a direction chosen per branch so nothing is silently lost.
  const scaled =
    decimals >= thorchainFixedPointDecimals
      ? thresholdIn1e8 * 10n ** BigInt(decimals - thorchainFixedPointDecimals)
      : thresholdIn1e8 / 10n ** BigInt(thorchainFixedPointDecimals - decimals)

  const dust = scaled * dustSafetyMultiple

  if (thresholdIn1e8 > 0n && dust <= 0n) {
    throw new LimitSwapCancelDustError(
      'belowObservableMinimum',
      `cancel dust: ${chain} threshold ${thresholdIn1e8} (1e8) rounds away at ${decimals} decimals, ` +
        'so no attachable amount would be observed'
    )
  }

  const ceiling = scaled * dustCeilingMultiple
  if (ceiling > 0n && dust > ceiling) {
    throw new LimitSwapCancelDustError(
      'exceedsCeiling',
      `cancel dust: computed ${dust} exceeds the ${chain} ceiling ${ceiling}`
    )
  }

  return dust
}
