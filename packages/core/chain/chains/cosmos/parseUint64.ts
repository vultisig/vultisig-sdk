const maxUint64 = (1n << 64n) - 1n

export const parseUint64 = ({ value, field, context }: { value: unknown; field: string; context: string }): bigint => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`Invalid ${context} ${field}: expected an unsigned integer`)
  }

  const parsed = BigInt(value)
  if (parsed > maxUint64) {
    throw new Error(`Invalid ${context} ${field}: exceeds uint64`)
  }

  return parsed
}
