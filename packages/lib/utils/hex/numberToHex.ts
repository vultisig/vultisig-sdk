import Long from 'long'
export const numberToHex = (num: number) => `0x${num.toString(16)}`

export const numberToEvenHex = (amount: number | Long | bigint) => {
  if (Long.isLong(amount) ? amount.isNegative() : amount < 0) {
    throw new RangeError('Hex encoding requires a non-negative value')
  }

  let hex = amount.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }
  return hex
}
