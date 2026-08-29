/**
 * Rendering and bounds shared by the Kamino amount types.
 */

/**
 * Solana instruction arguments are `u64`; anything above that cannot be
 * expressed on-chain regardless of what the API would accept.
 */
export const kaminoMaxBaseUnits = 2n ** 64n - 1n

/**
 * Widest decimal scale we are willing to handle. SPL mints are a `u8`, but
 * nothing legitimate approaches this, and an absurd scale would make the
 * `10^decimals` factors in the conversions unbounded.
 */
export const kaminoMaxDecimals = 18

/**
 * Renders base units as a plain human-units decimal string: no grouping, no
 * trailing zeros, no exponent. This is the form Kamino's request bodies take.
 */
export const renderKaminoBaseUnits = ({ baseUnits, decimals }: { baseUnits: bigint; decimals: number }): string => {
  const isNegative = baseUnits < 0n
  const digits = (isNegative ? -baseUnits : baseUnits).toString()
  if (decimals <= 0) return isNegative ? `-${digits}` : digits

  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '')

  const magnitude = fraction ? `${whole}.${fraction}` : whole
  return isNegative ? `-${magnitude}` : magnitude
}
