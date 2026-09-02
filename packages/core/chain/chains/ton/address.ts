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

/**
 * Lower-cased raw (`workchain:hex`) form of a raw or user-friendly TON address.
 * Toncenter answers in upper-case hex and ton-assets lists lower-case hex, so
 * every lookup keyed by a jetton master address must go through this first.
 */
export const tonAddressToRawKey = (address: string): string =>
  (address.includes(':') ? address : tonAddressToRaw(address)).toLowerCase()
