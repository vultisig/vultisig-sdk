import { classicAddressToXAddress, isValidXAddress, xAddressToClassicAddress } from 'ripple-address-codec'

export type RippleDestination = {
  address: string
  destinationTag?: number
}

const assertSupportedTag = (tag: number | false): number | undefined => {
  if (tag === false) return undefined
  return tag
}

/** Decode a mainnet XLS-5d X-address into the classic address and optional tag. */
export const decodeRippleXAddress = (address: string): RippleDestination => {
  const value = address.trim()
  if (!isValidXAddress(value)) throw new Error('Invalid XRP X-address')

  const decoded = xAddressToClassicAddress(value)
  if (decoded.test) throw new Error('XRP testnet X-addresses are not supported')

  return {
    address: decoded.classicAddress,
    destinationTag: assertSupportedTag(decoded.tag),
  }
}

export const isValidRippleXAddress = (address: string): boolean => {
  try {
    decodeRippleXAddress(address)
    return true
  } catch {
    return false
  }
}

/** Normalize a classic address or mainnet X-address for an XRP Payment. */
export const normalizeRippleDestination = (address: string): RippleDestination => {
  const value = address.trim()
  if (value.startsWith('X') || value.startsWith('T')) return decodeRippleXAddress(value)
  return { address: value }
}

/** Encode a mainnet X-address, primarily for UI round trips and test vectors. */
export const encodeRippleXAddress = (address: string, destinationTag?: number): string => {
  if (
    destinationTag !== undefined &&
    (!Number.isInteger(destinationTag) || destinationTag < 0 || destinationTag > 0xffffffff)
  ) {
    throw new Error('XRP X-address DestinationTag must be a nonnegative UInt32 integer')
  }
  return classicAddressToXAddress(address, destinationTag ?? false, false)
}
