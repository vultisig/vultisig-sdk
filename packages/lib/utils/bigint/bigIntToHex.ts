export const bigIntToHex = (value: bigint): string => {
  if (value < 0n) {
    throw new RangeError(`bigIntToHex: value must be non-negative, got ${value}`)
  }

  const hexString = value.toString(16)
  if (hexString.length % 2 !== 0) {
    return `0${hexString}`
  }
  return hexString
}
