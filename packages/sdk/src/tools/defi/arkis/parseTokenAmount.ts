/**
 * Parse a human-readable token amount (e.g. "1500" or "2500.25") into its raw
 * base-unit `bigint` given the token's decimals. String-only math — no float
 * round-trips, so it is exact for arbitrary precision.
 *
 * @throws if the amount is empty, negative, non-numeric, or has more fractional
 * digits than the token supports.
 */
export const parseArkisTokenAmount = (amount: string, decimals: number): bigint => {
  const trimmed = amount.trim()
  if (trimmed === '') throw new Error('empty amount')
  if (trimmed.startsWith('-')) throw new Error('negative amounts not allowed')

  const dotIdx = trimmed.indexOf('.')
  let wholePart = trimmed
  let fracPart = ''
  if (dotIdx !== -1) {
    wholePart = trimmed.slice(0, dotIdx)
    fracPart = trimmed.slice(dotIdx + 1)
    if (fracPart.includes('.')) throw new Error(`invalid amount: multiple decimal points in ${amount}`)
  }
  if (wholePart === '') wholePart = '0'
  if (!/^\d+$/.test(wholePart)) throw new Error(`invalid integer part: ${wholePart}`)
  if (fracPart && !/^\d+$/.test(fracPart)) throw new Error(`invalid fractional part: ${fracPart}`)
  if (fracPart.length > decimals) {
    throw new Error(`too many decimal places (max ${decimals}): ${amount}`)
  }

  while (fracPart.length < decimals) fracPart += '0'
  const wholeInt = BigInt(wholePart)
  const fracInt = fracPart.length > 0 ? BigInt(fracPart) : 0n
  return wholeInt * 10n ** BigInt(decimals) + fracInt
}
