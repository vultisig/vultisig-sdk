import { Address } from '@ton/core'
import { fromBase64 } from '@vultisig/lib-utils/fromBase64'

/** Converts base64url encoding to standard base64 so `Buffer.from` can decode it. */
const fromBase64Url = (value: string): Buffer => {
  const standardBase64 = value.replace(/-/g, '+').replace(/_/g, '/')
  return fromBase64(standardBase64)
}

/**
 * Converts a user-friendly TON address (EQ.../UQ...) to raw format (workchain:hex).
 * The toncenter v3 API requires raw addresses.
 */
export const tonAddressToRaw = (userFriendlyAddress: string): string => {
  const decoded = fromBase64Url(userFriendlyAddress)
  const workchain = decoded[1] >= 128 ? decoded[1] - 256 : decoded[1]
  const hash = decoded.subarray(2, 34).toString('hex')

  return `${workchain}:${hash}`
}

/**
 * Converts a raw TON address (`workchain:hex`) to the bounceable user-friendly
 * form (`EQ…`). Staking-API pool addresses arrive in raw `0:` form, which the
 * signer treats as non-bounceable — sending a deposit non-bounceable risks the
 * pool absorbing (losing) a rejected transfer instead of bouncing it back, so
 * pool destinations MUST be normalized to the bounceable form first. Inputs
 * already in user-friendly form are returned re-encoded as bounceable.
 */
export const tonAddressToBounceable = (address: string): string => {
  const parsed = address.includes(':') ? Address.parseRaw(address) : Address.parse(address)

  return parsed.toString({ bounceable: true, testOnly: false, urlSafe: true })
}

const parseTonAddress = (address: string): Address | undefined => {
  try {
    return Address.parse(address.trim())
  } catch {
    return undefined
  }
}

/**
 * Whether two TON addresses name the same account.
 *
 * One account has several textual spellings — raw `workchain:hex`, bounceable
 * `EQ…`, non-bounceable `UQ…`, and the base64 / base64url variants of both —
 * and only the flag byte and checksum differ between `EQ` and `UQ`. String
 * equality therefore reports differences that do not exist, which matters
 * wherever two independently sourced addresses are cross-checked before money
 * moves. Input that does not parse as a TON address falls back to exact
 * comparison rather than being reported as a match.
 */
export const areEqualTonAddresses = (left: string, right: string): boolean => {
  const parsedLeft = parseTonAddress(left)
  const parsedRight = parseTonAddress(right)

  return parsedLeft && parsedRight ? parsedLeft.equals(parsedRight) : left.trim() === right.trim()
}
