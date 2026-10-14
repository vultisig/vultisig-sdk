import { parseNonNegativeBigInt } from '@vultisig/lib-utils/bigint/parseNonNegativeBigInt'

export const NEAR_MAX_U64 = (1n << 64n) - 1n
export const NEAR_MAX_U128 = (1n << 128n) - 1n

/** A decimal u64/u128 payload field, refused above the width nearcore serializes it in. */
export const parseNearUint = (value: string, label: string, maximum: bigint): bigint => {
  const parsed = parseNonNegativeBigInt(value)

  if (parsed > maximum) {
    throw new Error(`Invalid NEAR ${label}: ${value} exceeds the chain's field width`)
  }

  return parsed
}
