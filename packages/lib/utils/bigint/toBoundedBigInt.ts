// A plain base-10 integer, optionally signed. Deliberately strict: `BigInt()`
// alone would also accept `''` (-> 0n), `'0x10'` (-> 16n) and whitespace-padded
// strings, all of which would WIDEN the accepted input in a guard whose whole
// job is to tighten it. The `''` case is the dangerous one: proto3 defaults an
// unset `toAmount` string to `''`, so `BigInt('')` would silently build a
// zero-amount transfer.
const INTEGER_STRING = /^-?\d+$/

/**
 * Strictly parses a decimal integer into a `bigint`, rejecting any value
 * outside the given bit width for the requested signedness.
 *
 * Companion to `toBoundedLong` for amount fields that are NOT proto 64-bit
 * integers: byte-encoded amounts (Tron TRC20 uint256 calldata, Polkadot u128
 * balances), SCALE-compact-encoded amounts (Bittensor), and decimal-string
 * amounts (XRPL issued currencies). Those encoders happily accept `0n` from
 * `BigInt('')`, so the strict parse is what turns an unset/malformed amount
 * into a throw instead of a silently co-signed zero-value transfer.
 */
export const toBoundedBigInt = (
  value: bigint | string,
  { bits, signed }: { bits: 64 | 128 | 256; signed: boolean }
): bigint => {
  if (typeof value === 'string' && !INTEGER_STRING.test(value)) {
    throw new RangeError(`toBoundedBigInt: expected a base-10 integer string, got ${JSON.stringify(value)}`)
  }

  const asBigInt = typeof value === 'bigint' ? value : BigInt(value)

  const [min, max] = signed ? [-(2n ** BigInt(bits - 1)), 2n ** BigInt(bits - 1) - 1n] : [0n, 2n ** BigInt(bits) - 1n]

  if (asBigInt < min || asBigInt > max) {
    throw new RangeError(
      `toBoundedBigInt: value ${asBigInt} out of ${signed ? 'signed' : 'unsigned'} ${bits}-bit range [${min}, ${max}]`
    )
  }

  return asBigInt
}
