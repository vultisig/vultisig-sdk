import Long from 'long'
export const numberToHex = (num: number) => `0x${num.toString(16)}`

export const numberToEvenHex = (amount: number | Long | bigint) => {
  // A negative value stringifies with a leading "-", which downstream
  // `Buffer.from(hex, 'hex')` silently turns into empty/garbage bytes. Fail
  // closed rather than emit a corrupted amount for co-signing.
  const isNegative =
    typeof amount === 'bigint' ? amount < 0n : typeof amount === 'number' ? amount < 0 : amount.isNegative()
  if (isNegative) {
    throw new RangeError(`numberToEvenHex: cannot hex-encode negative value ${amount.toString()}`)
  }
  let hex = amount.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }
  return hex
}
