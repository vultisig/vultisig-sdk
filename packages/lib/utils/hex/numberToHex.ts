import Long from 'long'
export const numberToHex = (num: number) => `0x${num.toString(16)}`

export const numberToEvenHex = (amount: number | Long | bigint) => {
  if (
    (typeof amount === 'bigint' && amount < 0n) ||
    (typeof amount === 'number' && amount < 0) ||
    (Long.isLong(amount) && amount.isNegative())
  ) {
    throw new RangeError(`numberToEvenHex: amount must be non-negative, got ${amount.toString()}`)
  }

  let hex = amount.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }
  return hex
}
