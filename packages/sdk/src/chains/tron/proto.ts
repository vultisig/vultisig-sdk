/**
 * Hand-rolled Protobuf encoder for Tron transactions.
 *
 * Tron transactions are protobuf-encoded then SHA-256 hashed for signing.
 * We don't pull `protobufjs` or `@bufbuild/protobuf` here because the field
 * set we need is tiny (ref_block_*, expiration, contract, timestamp,
 * fee_limit plus two contract payloads) and the cost of a schema runtime
 * isn't worth it for Hermes bundle size.
 *
 * Wire-format notes that matter for byte parity:
 *
 *  - Tag byte = `(fieldNum << 3) | wireType`.
 *      wireType 0 = varint; wireType 2 = length-delimited bytes.
 *
 *  - Protobuf's `int64` is encoded as a standard varint of the two's
 *    complement of the value. For positive ints, that is the same as `uint64`
 *    varint. For NEGATIVE ints, the encoding is always 10 bytes: the lower
 *    63 bits of the 64-bit two's-complement representation, each 7-bit group
 *    MSB-set for continuation, and a final byte carrying the top bit.
 *    Shortening negative int64 to fewer than 10 bytes is a common mistake
 *    that produces a silently different on-chain hash.
 */

// ---------------------------------------------------------------------------
// Primitive encoders
// ---------------------------------------------------------------------------

/** Standard protobuf varint of a non-negative integer. */
export function encodeVarint(value: number | bigint): Uint8Array {
  let v = BigInt(value)
  if (v < 0n) throw new Error(`encodeVarint: value must be non-negative, got ${v}`)
  const bytes: number[] = []
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80)
    v >>= 7n
  }
  bytes.push(Number(v & 0x7fn))
  return new Uint8Array(bytes)
}

/**
 * Protobuf int64 varint — two's-complement encoding for negatives.
 *
 * For a negative int64 `n`, the spec requires 10 bytes: we reinterpret the
 * 64-bit two's-complement pattern as an unsigned 64-bit integer and emit
 * the varint for that value. The 10-byte fixed length is because
 * reinterpreting a negative int64 as uint64 always leaves bit 63 set, and
 * a varint for a value ≥ 2^63 always takes 10 bytes (9 continuation bytes
 * + 1 final byte with the high bit of the original 64-bit integer).
 */
export function encodeInt64Varint(value: bigint): Uint8Array {
  if (value >= 0n) return encodeVarint(value)
  // Two's-complement mask — BigInt.asUintN(64, x) is mathematically
  // `x + 2^64` for negative x in [-2^63, -1]. Output is in [2^63, 2^64-1],
  // which always serializes as a 10-byte varint.
  let v = BigInt.asUintN(64, value)
  const bytes: number[] = new Array(10)
  for (let i = 0; i < 9; i++) {
    bytes[i] = Number(v & 0x7fn) | 0x80
    v >>= 7n
  }
  // The 10th byte holds the top bit (bit 63 of the original int64 = 1 for
  // any negative int64) without a continuation marker.
  bytes[9] = Number(v & 0x01n)
  return new Uint8Array(bytes)
}

function encodeTag(fieldNum: number, wireType: 0 | 2): Uint8Array {
  return encodeVarint((fieldNum << 3) | wireType)
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

// ---------------------------------------------------------------------------
// Field encoders
// ---------------------------------------------------------------------------

/** Varint field (uint32/uint64 — non-negative). */
export function fieldVarint(fieldNum: number, value: number | bigint): Uint8Array {
  return concatBytes(encodeTag(fieldNum, 0), encodeVarint(value))
}

/** int64 field — two's-complement for negatives. */
export function fieldInt64(fieldNum: number, value: bigint): Uint8Array {
  return concatBytes(encodeTag(fieldNum, 0), encodeInt64Varint(value))
}

/** Length-delimited bytes field. */
export function fieldBytes(fieldNum: number, data: Uint8Array): Uint8Array {
  return concatBytes(encodeTag(fieldNum, 2), encodeVarint(data.length), data)
}

/** Length-delimited string field (UTF-8). */
export function fieldString(fieldNum: number, str: string): Uint8Array {
  return fieldBytes(fieldNum, new TextEncoder().encode(str))
}

export { concatBytes as concatProtoBytes }
