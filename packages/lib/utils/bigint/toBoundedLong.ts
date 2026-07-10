import Long from 'long'

const SIGNED_MIN = -(2n ** 63n)
const SIGNED_MAX = 2n ** 63n - 1n
const UNSIGNED_MAX = 2n ** 64n - 1n

// A plain base-10 integer, optionally signed. Deliberately strict: `BigInt()`
// alone would also accept `''` (-> 0n), `'0x10'` (-> 16n) and whitespace-padded
// strings, all of which would WIDEN the accepted input in a guard whose whole
// job is to tighten it. The `''` case is the dangerous one: proto3 defaults an
// unset `toAmount` string to `''`, so `BigInt('')` would silently build a
// zero-amount transfer where the old `Long.fromString('')` threw.
const INTEGER_STRING = /^-?\d+$/

/**
 * Parses a decimal integer into a `Long`, rejecting any value outside the
 * 64-bit range for the requested signedness BEFORE conversion.
 *
 * `Long.fromString` silently two's-complement-wraps an out-of-range magnitude
 * (e.g. `2^64 -> 0`, `2^63 -> -2^63`), so an amount larger than 64 bits would be
 * co-signed as a different value than the caller intended. This is the same
 * wraparound class `varintBig` already guards on the cosmos proto path.
 *
 * Signedness must match the target proto field: pass `{ unsigned: true }` for a
 * proto `uint64` amount (e.g. Sui / Cardano) so the legitimate `(2^63, 2^64)`
 * range is accepted, and `{ unsigned: false }` for a proto `int64` field
 * (e.g. Tron / Ripple).
 */
export const toBoundedLong = (value: bigint | string, { unsigned }: { unsigned: boolean }): Long => {
  if (typeof value === 'string' && !INTEGER_STRING.test(value)) {
    throw new RangeError(`toBoundedLong: expected a base-10 integer string, got ${JSON.stringify(value)}`)
  }

  const asBigInt = typeof value === 'bigint' ? value : BigInt(value)

  const [min, max] = unsigned ? [0n, UNSIGNED_MAX] : [SIGNED_MIN, SIGNED_MAX]

  if (asBigInt < min || asBigInt > max) {
    throw new RangeError(
      `toBoundedLong: value ${asBigInt} out of ${unsigned ? 'unsigned' : 'signed'} 64-bit range [${min}, ${max}]`
    )
  }

  return Long.fromString(asBigInt.toString(), unsigned)
}
