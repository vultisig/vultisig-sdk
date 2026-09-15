export const bigIntToHex = (value: bigint): string => {
  if (value < 0n) {
    throw new RangeError('Hex encoding requires a non-negative value')
  }

  const hexString = value.toString(16)
  if (hexString.length % 2 !== 0) {
    return `0${hexString}`
  }
  return hexString
}
