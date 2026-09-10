/** Parse base-unit amounts without BigInt's empty-string, whitespace or radix coercions. */
export const parseNonNegativeBigInt = (value: string): bigint => {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) {
    throw new Error('amount must be a nonempty nonnegative decimal integer string')
  }

  return BigInt(value)
}
