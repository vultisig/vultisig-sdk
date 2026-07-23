export const bigIntToHex = (value: bigint): string => {
  // A negative bigint stringifies with a leading "-", which downstream
  // `Buffer.from(hex, 'hex')` silently turns into empty/garbage bytes — the
  // co-signers would then sign over a value unrelated to the input. Amounts,
  // nonces and values through this encoder are never legitimately negative.
  if (value < 0n) {
    throw new RangeError(`bigIntToHex: cannot hex-encode negative value ${value}`)
  }
  const hexString = value.toString(16)
  if (hexString.length % 2 !== 0) {
    return `0${hexString}`
  }
  return hexString
}
