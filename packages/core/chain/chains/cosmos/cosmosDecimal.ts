/**
 * Exact-rational decimal parsing/fee math shared by every cosmos gas-price
 * resolver (the generic node-config path and Osmosis's dynamic EIP-1559
 * path). Kept in its own module so both can depend on it without a circular
 * import between them.
 */
export type ParsedDecimal = {
  numerator: bigint
  denominator: bigint
}

/** Parses a non-negative decimal string (e.g. "0.030000000000000000") into an exact fraction. */
export const parseDecimal = (value: string): ParsedDecimal | undefined => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined

  const [whole, fraction = ''] = value.split('.')
  const denominator = 10n ** BigInt(fraction.length)
  const numerator = BigInt(`${whole}${fraction}`)

  return { numerator, denominator }
}

/** ceil(gasLimit * gasPrice), computed as an exact fraction - never loses precision to IEEE-754 rounding. */
export const getFeeAmountFromGasPrice = (gasLimit: bigint, gasPrice: ParsedDecimal): bigint => {
  const total = gasLimit * gasPrice.numerator

  return (total + gasPrice.denominator - 1n) / gasPrice.denominator
}
