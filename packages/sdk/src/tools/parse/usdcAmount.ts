/** USDC uses 6 decimal places on the supported first-party integrations. */
export const USDC_DECIMALS = 6

/**
 * Convert a human-readable USDC amount into raw 6-decimal units.
 *
 * @throws if the amount is empty, signed, non-numeric, or has more than
 * 6 decimal places.
 */
export const parseUsdcAmount = (value: string): bigint => {
  const trimmed = value.trim()
  if (trimmed === '') throw new Error('empty amount')
  if (trimmed.startsWith('-')) throw new Error('negative amounts not allowed')

  const dotIndex = trimmed.indexOf('.')
  let wholePart = dotIndex === -1 ? trimmed : trimmed.slice(0, dotIndex)
  let fractionalPart = dotIndex === -1 ? '' : trimmed.slice(dotIndex + 1)

  if (fractionalPart.includes('.')) {
    throw new Error(`invalid amount: multiple decimal points in ${value}`)
  }
  if (wholePart === '') wholePart = '0'
  if (fractionalPart.length > USDC_DECIMALS) {
    throw new Error(`too many decimal places (max ${USDC_DECIMALS} for USDC): ${value}`)
  }
  if (!/^\d+$/.test(wholePart)) throw new Error(`invalid integer part: ${wholePart}`)
  if (fractionalPart !== '' && !/^\d+$/.test(fractionalPart)) {
    throw new Error(`invalid fractional part: ${fractionalPart}`)
  }

  fractionalPart = fractionalPart.padEnd(USDC_DECIMALS, '0')
  const fractionalUnits = fractionalPart === '' ? 0n : BigInt(fractionalPart)
  return BigInt(wholePart) * 10n ** BigInt(USDC_DECIMALS) + fractionalUnits
}

/** Format a raw 6-decimal USDC amount back to a human-readable string. */
export const formatUsdc = (raw: bigint): string => {
  const divisor = 10n ** BigInt(USDC_DECIMALS)
  const whole = raw / divisor
  const fractional = raw % divisor
  if (fractional === 0n) return whole.toString()
  return `${whole}.${fractional.toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '')}`
}
