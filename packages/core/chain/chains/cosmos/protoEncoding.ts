/**
 * Manual protobuf wire-format encoding for cosmos-sdk transactions.
 *
 * Required because WalletCore cannot handle every proto message we need to
 * sign — MLDSA-keyed QBTC, and React-Native paths that intentionally avoid
 * the WalletCore IBC-transfer encoder so they can run without the native
 * dependency.
 *
 * Two layers:
 *
 *  Lower-level (`varintBig`, `protoField`) — primitives that do NOT apply
 *    proto3 default-elision. Callers handle the "skip on zero / empty string"
 *    contract themselves at message-build time. Useful when the caller already
 *    knows which fields are present (e.g. cosmjs-types-style encoders, IBC
 *    `MsgTransfer` where `timeout_height` is always emitted even when zeroed).
 *
 *  Higher-level (`protoVarint`, `protoBytes`, `protoString`) — apply proto3
 *    default-elision automatically (skip 0n / empty bytes / empty string).
 *    Used by QBTC's claim message builder where the call sites are exhaustive
 *    and shorter to write without per-field guards.
 *
 *  Both layers share `concatBytes`.
 */

// ---------------------------------------------------------------------------
// Wire type constants
// ---------------------------------------------------------------------------

/**
 * Protobuf wire-type tags. We only encode wire types 0 (varint) and 2
 * (length-delimited) — every cosmos-sdk + IBC message we sign is composed of
 * these two. Wire types 1/5 (fixed64/fixed32) and 3/4 (deprecated groups) are
 * not used.
 *
 * @see https://protobuf.dev/programming-guides/encoding/#structure
 */
export const WireType = {
  Varint: 0,
  LengthDelimited: 2,
} as const

export type WireType = (typeof WireType)[keyof typeof WireType]

// ---------------------------------------------------------------------------
// Primitive encoders
// ---------------------------------------------------------------------------

/**
 * Encodes a UInt64 as a protobuf base-128 varint.
 *
 * Bigint-only: callers like IBC `MsgTransfer.timeout_timestamp` carry UNIX
 * nanoseconds, which crossed 2^53 in 2022 — a JS `number` shift-based varint
 * silently corrupts those values. The full 64-bit unsigned range
 * (`0n .. 2^64 - 1`) is supported and validated.
 */
export const varintBig = (value: bigint): Uint8Array => {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError('varintBig expects an unsigned 64-bit integer')
  }

  const bytes: number[] = []
  let v = value
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80)
    v >>= 7n
  }
  bytes.push(Number(v))
  return new Uint8Array(bytes)
}

/**
 * Encodes a (fieldNumber, wireType) pair as a single varint tag.
 *
 * Tag layout: `(fieldNumber << 3) | wireType`. `fieldNumber` must fit in
 * 29 bits (proto spec MAX_FIELD_NUMBER = 2^29 - 1).
 */
const encodeFieldTag = (fieldNumber: number, wireType: WireType): Uint8Array => {
  if (
    !Number.isInteger(fieldNumber) ||
    fieldNumber < 1 ||
    fieldNumber >= 1 << 29
  ) {
    throw new RangeError(
      `encodeFieldTag: fieldNumber must be in [1, 2^29 - 1], got ${fieldNumber}`
    )
  }
  return varintBig(BigInt((fieldNumber << 3) | wireType))
}

/**
 * Lower-level field encoder. Emits a tag followed by the field payload — the
 * payload is treated as opaque bytes (you must already have encoded it
 * correctly for the wire type). Does NOT apply proto3 default-elision.
 *
 * For varint fields (wireType 0), pass `varintBig(value)` as the data. For
 * length-delimited fields (wireType 2), the caller is responsible for the
 * length prefix only when payload is provided pre-length-prefixed; this
 * function adds the length prefix automatically for wire type 2.
 *
 * Used by IBC-transfer encoders (`MsgTransfer`, the inner `Height` submessage)
 * where some fields must be emitted even at the proto3 default value.
 */
export const protoField = (
  fieldNumber: number,
  wireType: WireType,
  data: Uint8Array
): Uint8Array => {
  const tag = encodeFieldTag(fieldNumber, wireType)
  if (wireType === WireType.LengthDelimited) {
    const length = varintBig(BigInt(data.length))
    return concatBytes(tag, length, data)
  }
  // Varint: data is already the encoded varint bytes.
  return concatBytes(tag, data)
}

// ---------------------------------------------------------------------------
// Default-eliding higher-level encoders
// ---------------------------------------------------------------------------

/** Appends a varint field (wire type 0). Skips if value is 0 (proto3 default). */
export const protoVarint = (fieldNumber: number, value: bigint): Uint8Array => {
  if (value === 0n) return new Uint8Array(0)
  return protoField(fieldNumber, WireType.Varint, varintBig(value))
}

/** Appends a length-delimited field (wire type 2) for raw bytes. */
export const protoBytes = (
  fieldNumber: number,
  data: Uint8Array
): Uint8Array => {
  if (data.length === 0) return new Uint8Array(0)
  return protoField(fieldNumber, WireType.LengthDelimited, data)
}

/** Appends a length-delimited field (wire type 2) for a UTF-8 string. */
export const protoString = (fieldNumber: number, value: string): Uint8Array => {
  if (value.length === 0) return new Uint8Array(0)
  return protoBytes(fieldNumber, new TextEncoder().encode(value))
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Concatenates multiple Uint8Arrays. */
export const concatBytes = (...arrays: Uint8Array[]): Uint8Array => {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}
