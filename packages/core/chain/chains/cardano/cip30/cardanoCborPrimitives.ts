/**
 * Minimal hand-rolled CBOR primitives for Cardano wire format.
 *
 * cbor-x tags Uint8Arrays and encodes Maps with text keys by default,
 * breaking Cardano's strict unsigned-integer-key maps. These helpers
 * produce spec-conformant CBOR without any library.
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

/** Encode a CBOR byte string (major type 2). */
export const cborBytes = (data: Uint8Array): Uint8Array => {
  const head = cborHead(2, data.length)
  return concat([head, data])
}

/** Encode a CBOR text string (major type 3). */
export const cborText = (s: string): Uint8Array => {
  const utf8 = new TextEncoder().encode(s)
  return concat([cborHead(3, utf8.length), utf8])
}

/** Encode a CBOR unsigned integer (major type 0). */
export const cborUint = (n: number): Uint8Array => cborHead(0, n)

/** Encode a CBOR negative integer (major type 1): encodes value -(n+1). */
export const cborNegint = (n: number): Uint8Array => cborHead(1, n)

/** Encode a CBOR array header (major type 4) followed by items. */
export const cborArray = (items: Uint8Array[]): Uint8Array =>
  concat([cborHead(4, items.length), ...items])

/** Encode a CBOR map header (major type 5) followed by key-value pairs. */
export const cborMap = (entries: Array<[Uint8Array, Uint8Array]>): Uint8Array =>
  concat([
    cborHead(5, entries.length),
    ...entries.flatMap(([k, v]) => [k, v]),
  ])

/**
 * Encode the major-type + argument head (RFC 8949 §3.1).
 *
 * `value` must be a non-negative safe integer ≤ 0xFFFFFFFF. Throws otherwise —
 * the callers here (COSE keys, witness-set indices, small lengths) never need
 * 64-bit arguments, and silently truncating a bigger value would produce
 * invalid CBOR that downstream consumers only catch at parse time.
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
