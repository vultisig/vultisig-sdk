/**
 * Minimal hand-rolled CBOR primitives for Cardano CIP-8 / CIP-30 wire format.
 *
 * `cbor-x` tags `Uint8Array` and encodes `Map` with text keys by default,
 * breaking Cardano's strict unsigned-integer-key maps (COSE headers, witness
 * sets, multiasset). These helpers produce spec-conformant CBOR without the
 * library shape collision.
 *
 * **Scope and limits.** Every `uint` / length argument these primitives emit
 * fits in the CBOR `additional = 26` form (4-byte argument, max `2^32 - 1`).
 * That is sufficient for all of our Cardano CIP-8 / CIP-30 call sites:
 *
 * - COSE header keys / algorithm identifiers: small ints (e.g. 1, 3, 6, −8).
 * - Witness-set entry keys: small ints (0 for vkey witnesses).
 * - Byte/text string lengths, array/map cardinalities: well under 2^32.
 *
 * Cardano `value` / `coin` — the one place a CBOR uint *could* exceed 2^32
 * (lovelace) — is **not** encoded through these primitives; it goes through
 * `cardanoCborEncoder` (cbor-x) which handles the 8-byte argument form.
 *
 * Anything outside that range is rejected by `cborHead` with a clear error
 * rather than silently truncated (RFC 8949 §3.1 mandates the smallest form,
 * but truncating would produce structurally invalid CBOR). If you have a
 * legitimate 64-bit uint to encode here in the future, extend `cborHead` to
 * accept `bigint` and emit the `additional = 27` (8-byte) form — don't route
 * it around this check.
 */

/** Concatenate byte arrays. */
export const concat = (parts: Uint8Array[]): Uint8Array => {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** Encode a CBOR byte string (major type 2). Length must be ≤ 2^32 − 1. */
export const cborBytes = (data: Uint8Array): Uint8Array => {
  const head = cborHead(2, data.length)
  return concat([head, data])
}

/** Encode a CBOR text string (major type 3). UTF-8 byte length must be ≤ 2^32 − 1. */
export const cborText = (s: string): Uint8Array => {
  const utf8 = new TextEncoder().encode(s)
  return concat([cborHead(3, utf8.length), utf8])
}

/**
 * Encode a CBOR unsigned integer (major type 0).
 *
 * `n` must be a non-negative integer in `[0, 2^32 − 1]`. Throws otherwise.
 * See the module-level docstring for why 64-bit uints route through
 * `cardanoCborEncoder` instead.
 */
export const cborUint = (n: number): Uint8Array => cborHead(0, n)

/**
 * Encode a CBOR negative integer (major type 1): encodes the value `-(n+1)`.
 *
 * `n` must be a non-negative integer in `[0, 2^32 − 1]` (i.e. the encoded
 * value lies in `[-2^32, -1]`). Throws otherwise.
 */
export const cborNegint = (n: number): Uint8Array => cborHead(1, n)

/** Encode a CBOR array header (major type 4) followed by items. Cardinality must be ≤ 2^32 − 1. */
export const cborArray = (items: Uint8Array[]): Uint8Array =>
  concat([cborHead(4, items.length), ...items])

/** Encode a CBOR map header (major type 5) followed by key-value pairs. Cardinality must be ≤ 2^32 − 1. */
export const cborMap = (entries: Array<[Uint8Array, Uint8Array]>): Uint8Array =>
  concat([
    cborHead(5, entries.length),
    ...entries.flatMap(([k, v]) => [k, v]),
  ])

/**
 * Encode the major-type + argument head (RFC 8949 §3.1).
 *
 * `value` must be a non-negative safe integer ≤ 2^32 − 1. Throws otherwise —
 * see the module-level docstring for the rationale.
 */
const cborHead = (majorType: number, value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(
      `cborHead: value must be a non-negative integer ≤ 2^32-1, got ${value}`
    )
  }
  const mt = majorType << 5
  if (value < 24) return Uint8Array.of(mt | value)
  if (value < 0x100) return Uint8Array.of(mt | 24, value)
  if (value < 0x10000) {
    return Uint8Array.of(mt | 25, (value >> 8) & 0xff, value & 0xff)
  }
  return Uint8Array.of(
    mt | 26,
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  )
}
