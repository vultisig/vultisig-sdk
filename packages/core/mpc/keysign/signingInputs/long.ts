import Long from 'long'

const uint64Max = (1n << 64n) - 1n
const unsignedDecimalRegex = /^\d+$/

export const unsignedLongFromString = (value: string | number | bigint, fieldName: string): Long => {
  const decimal = value.toString()

  if (!unsignedDecimalRegex.test(decimal)) {
    throw new Error(`${fieldName} must be a non-negative integer`)
  }

  const parsed = BigInt(decimal)
  if (parsed > uint64Max) {
    throw new Error(`${fieldName} exceeds uint64`)
  }

  return Long.fromString(decimal, true)
}
