export type ComputeCosmosTxReceiptFeeAmountInput = {
  gasUsed: bigint
  gasWantedFromTx: bigint
  feeGasLimit: bigint
  maxFeeAmount: bigint
}

/**
 * Proportional native fee from max fee, gas used, and a gas denominator.
 * Denominator prefers `gasWantedFromTx` when positive, else `feeGasLimit`,
 * else `gasUsed` (treats max fee as paid when no better estimate exists).
 * Result is clamped to `maxFeeAmount`.
 */
export const computeCosmosTxReceiptFeeAmount = ({
  gasUsed,
  gasWantedFromTx,
  feeGasLimit,
  maxFeeAmount,
}: ComputeCosmosTxReceiptFeeAmountInput): bigint | undefined => {
  if (gasUsed === 0n || maxFeeAmount === 0n) {
    return undefined
  }

  const gasDenominator =
    gasWantedFromTx > 0n
      ? gasWantedFromTx
      : feeGasLimit > 0n
        ? feeGasLimit
        : gasUsed

  if (gasDenominator === 0n) {
    return undefined
  }

  let actualFee = (maxFeeAmount * gasUsed) / gasDenominator
  if (actualFee > maxFeeAmount) {
    actualFee = maxFeeAmount
  }

  if (actualFee === 0n) {
    return undefined
  }

  return actualFee
}
