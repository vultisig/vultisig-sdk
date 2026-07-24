const USDC_DECIMALS = 6

/**
 * Parse a human-readable USDC amount (e.g. "10", "10.5") into raw 6-decimal units.
 *
 * Rejects signs and non-digit integer/fractional parts so every consumer shares the
 * same exact acceptance contract.
 */
export function parseUsdcAmount(s: string): bigint {
  const trimmed = s.trim()
  if (trimmed === '') throw new Error('empty amount')
  if (trimmed.startsWith('-')) throw new Error('negative amounts not allowed')

  const dotIdx = trimmed.indexOf('.')
  let wholePart = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx)
  let fracPart = dotIdx === -1 ? '' : trimmed.slice(dotIdx + 1)

  if (fracPart.includes('.')) throw new Error(`invalid amount: multiple decimal points in ${s}`)
  if (wholePart === '') wholePart = '0'
  if (!/^\d+$/.test(wholePart)) throw new Error(`invalid integer part: ${wholePart}`)
  if (fracPart !== '' && !/^\d+$/.test(fracPart)) throw new Error(`invalid fractional part: ${fracPart}`)
  if (fracPart.length > USDC_DECIMALS) {
    throw new Error(`too many decimal places (max ${USDC_DECIMALS} for USDC): ${s}`)
  }

  while (fracPart.length < USDC_DECIMALS) fracPart += '0'
  const fracInt = fracPart === '' ? 0n : BigInt(fracPart)
  return BigInt(wholePart) * 10n ** BigInt(USDC_DECIMALS) + fracInt
}
