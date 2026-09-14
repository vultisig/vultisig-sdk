const boundsByKind = {
  int64: { min: -(1n << 63n), max: (1n << 63n) - 1n },
  uint64: { min: 0n, max: (1n << 64n) - 1n },
} as const

export type BoundedIntKind = keyof typeof boundsByKind

/**
 * Validates that a decimal integer string fits within a proto field's
 * declared 64-bit range, throwing instead of letting a downstream
 * `Long.fromString` / `BigInt()` call silently two's-complement-wrap an
 * out-of-range magnitude (e.g. 2^64 -> 0, 2^63 -> -2^63 for `int64`). Returns
 * the input unchanged on success so callers can pipe it straight into
 * `Long.fromString` / `BigInt()`.
 *
 * sdk#1200 — fee/gas siblings of the transfer-amount class sdk#1140/#1197
 * cover: a wrapped fee is money too (a wrapped fee limit could authorize an
 * outsized fee burn; a wrapped priority fee misprices the tx).
 */
export function assertBoundedInt(value: string, kind: BoundedIntKind): string {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`assertBoundedInt: "${value}" is not a plain decimal integer string`)
  }

  const parsed = BigInt(value)
  const { min, max } = boundsByKind[kind]
  if (parsed < min || parsed > max) {
    throw new Error(`assertBoundedInt: ${value} is out of ${kind} range [${min}, ${max}]`)
  }

  return value
}
