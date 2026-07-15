import Long from 'long'

import { toBoundedBigInt } from './toBoundedBigInt'

/**
 * Parses a decimal integer into a `Long`, rejecting any value outside the
 * 64-bit range for the requested signedness BEFORE conversion.
 *
 * `Long.fromString` silently two's-complement-wraps an out-of-range magnitude
 * (e.g. `2^64 -> 0`, `2^63 -> -2^63`), so an amount larger than 64 bits would be
 * co-signed as a different value than the caller intended. This is the same
 * wraparound class `varintBig` already guards on the cosmos proto path.
 *
 * String parsing is deliberately strict (see `toBoundedBigInt`): `''`,
 * hex-prefixed and whitespace-padded strings all throw instead of silently
 * widening the accepted input. The `''` case is the dangerous one: proto3
 * defaults an unset `toAmount` string to `''`, so `BigInt('')` would silently
 * build a zero-amount transfer where the old `Long.fromString('')` threw.
 *
 * Signedness must match the target proto field: pass `{ unsigned: true }` for a
 * proto `uint64` amount (e.g. Sui / Cardano) so the legitimate `(2^63, 2^64)`
 * range is accepted, and `{ unsigned: false }` for a proto `int64` field
 * (e.g. Tron / Ripple).
 */
export const toBoundedLong = (value: bigint | string, { unsigned }: { unsigned: boolean }): Long => {
  const bounded = toBoundedBigInt(value, { bits: 64, signed: !unsigned })

  return Long.fromString(bounded.toString(), unsigned)
}
