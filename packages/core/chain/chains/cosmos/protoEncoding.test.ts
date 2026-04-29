import { describe, expect, it } from 'vitest'

import {
  concatBytes,
  protoBytes,
  protoField,
  protoString,
  protoVarint,
  varintBig,
  WireType,
} from './protoEncoding'

// ---------------------------------------------------------------------------
// Wire-format expectations are hand-derived from the protobuf encoding spec
// (https://protobuf.dev/programming-guides/encoding/) — no `cosmjs-types` /
// `protobufjs` decoder dependency, so this test file is self-contained and
// `core-chain` does not gain a new devDependency just to verify its own
// helpers.
//
// For each non-trivial assertion, the comment shows the byte-by-byte
// derivation alongside the expected hex so a reviewer can audit without
// running an oracle.
// ---------------------------------------------------------------------------

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

describe('varintBig', () => {
  it('encodes 0n as a single zero byte', () => {
    expect(hex(varintBig(0n))).toBe('00')
  })

  it('encodes values that fit in 7 bits as a single byte without continuation', () => {
    expect(hex(varintBig(1n))).toBe('01')
    expect(hex(varintBig(127n))).toBe('7f')
  })

  it('encodes 128 as 0x80 0x01 (continuation + most-significant nibble)', () => {
    // 128 = 0b1000_0000 → split into two 7-bit groups: low=0x00, high=0x01.
    // First byte gets the continuation bit (0x80).
    expect(hex(varintBig(128n))).toBe('8001')
  })

  it('encodes 300 as 0xac 0x02', () => {
    // 300 = 0b1_0010_1100. low7 = 0010_1100 = 0x2c → with cont 0xac.
    // high7 = 0000_0010 = 0x02. Wire bytes = ac 02.
    expect(hex(varintBig(300n))).toBe('ac02')
  })

  it('handles uint64 values past 2^53 (the JS-number-safe-integer ceiling)', () => {
    // IBC `MsgTransfer.timeout_timestamp` carries UNIX nanoseconds — has been
    // past 2^53 since 2022 — so this is the load-bearing case for varintBig
    // existing alongside any number-shift varint.
    const v = 1_700_000_000_000_000_000n // 2023-11 nanoseconds-ish
    // We assert encode-then-decode round-trip rather than hand-compute 9
    // bytes; the round-trip catches both directions of the varint algorithm.
    const decoded = decodeVarint(varintBig(v))
    expect(decoded).toBe(v)
  })

  it('encodes the maximum uint64 (2^64 - 1) as 10 bytes of 0xff…01', () => {
    // Standard varint max-uint64 wire form: 0xff repeated 9 times then 0x01.
    expect(hex(varintBig(0xffff_ffff_ffff_ffffn))).toBe('ffffffffffffffffff01')
  })

  it('rejects negative values', () => {
    expect(() => varintBig(-1n)).toThrow(/unsigned 64-bit/)
  })

  it('rejects values exceeding uint64', () => {
    expect(() => varintBig(0x1_0000_0000_0000_0000n)).toThrow(/unsigned 64-bit/)
  })
})

describe('protoField (no default-elision)', () => {
  it('encodes a varint field as <tag><value-varint>', () => {
    // field 1, wire 0 → tag = (1<<3)|0 = 0x08.
    // value 42 → 0x2a.
    expect(hex(protoField(1, WireType.Varint, varintBig(42n)))).toBe('082a')
  })

  it('emits the tag even when the varint value is the proto3 default (0)', () => {
    // This is the whole point of the lower-level `protoField` vs the
    // default-eliding `protoVarint`: IBC `MsgTransfer.timeout_height`'s
    // submessage requires emitting `revisionNumber=0` / `revisionHeight=0`
    // in some encoder dialects, and we want the helper to oblige.
    expect(hex(protoField(1, WireType.Varint, varintBig(0n)))).toBe('0800')
  })

  it('encodes a length-delimited field with auto length prefix', () => {
    // field 3, wire 2 → tag = (3<<3)|2 = 0x1a. payload = "hi" = 0x68 0x69.
    // length prefix = varint(2) = 0x02.
    const payload = new TextEncoder().encode('hi')
    expect(hex(protoField(3, WireType.LengthDelimited, payload))).toBe(
      '1a026869'
    )
  })

  it('encodes an empty length-delimited field as just <tag><0>', () => {
    // Lower-level: caller decides whether to emit at all. Empty submessages
    // (e.g. a fully-zero `Height`) need the bare tag + zero length.
    expect(hex(protoField(6, WireType.LengthDelimited, new Uint8Array(0)))).toBe(
      '3200'
    )
  })

  it('encodes a high field number that needs a multi-byte tag varint', () => {
    // field 16: tag = (16<<3)|0 = 0x80 → varint ⇒ 0x80 0x01.
    expect(hex(protoField(16, WireType.Varint, varintBig(1n)))).toBe('800101')
  })

  it('rejects field number 0', () => {
    expect(() => protoField(0, WireType.Varint, varintBig(1n))).toThrow(
      /fieldNumber/
    )
  })

  it('rejects field numbers >= 2^29', () => {
    expect(() => protoField(1 << 29, WireType.Varint, varintBig(1n))).toThrow(
      /fieldNumber/
    )
  })
})

describe('protoVarint (default-eliding)', () => {
  it('emits empty bytes when value is 0n (proto3 default)', () => {
    expect(protoVarint(1, 0n)).toEqual(new Uint8Array(0))
  })

  it('emits <tag><value> when value is non-zero', () => {
    expect(hex(protoVarint(1, 42n))).toBe('082a')
  })
})

describe('protoBytes', () => {
  it('emits empty bytes when payload is empty', () => {
    expect(protoBytes(1, new Uint8Array(0))).toEqual(new Uint8Array(0))
  })

  it('emits <tag><len><payload> for non-empty payload', () => {
    // field 2, wire 2 → tag = (2<<3)|2 = 0x12. payload = [0xde 0xad] (2 bytes).
    expect(hex(protoBytes(2, new Uint8Array([0xde, 0xad])))).toBe('1202dead')
  })
})

describe('protoString', () => {
  it('emits empty bytes for empty string', () => {
    expect(protoString(1, '')).toEqual(new Uint8Array(0))
  })

  it('encodes UTF-8 string payload with length prefix', () => {
    // field 1, wire 2 → tag 0x0a. "hi" → 0x68 0x69, length 2.
    expect(hex(protoString(1, 'hi'))).toBe('0a026869')
  })

  it('encodes multi-byte UTF-8 correctly (length is bytes, not codepoints)', () => {
    // field 1. "é" is 2 UTF-8 bytes (0xc3 0xa9) — length prefix is 2, not 1.
    expect(hex(protoString(1, 'é'))).toBe('0a02c3a9')
  })
})

describe('concatBytes', () => {
  it('returns an empty Uint8Array when called with no arguments', () => {
    expect(concatBytes()).toEqual(new Uint8Array(0))
  })

  it('concatenates in the given order', () => {
    expect(
      hex(
        concatBytes(
          new Uint8Array([0x01, 0x02]),
          new Uint8Array([0x03]),
          new Uint8Array([0x04, 0x05])
        )
      )
    ).toBe('0102030405')
  })

  it('handles a mix of empty and non-empty inputs', () => {
    expect(
      hex(
        concatBytes(
          new Uint8Array(0),
          new Uint8Array([0xff]),
          new Uint8Array(0),
          new Uint8Array([0xaa])
        )
      )
    ).toBe('ffaa')
  })
})

// ---------------------------------------------------------------------------
// End-to-end: assemble a real cosmos-sdk message and assert byte-for-byte.
// `cosmos.base.v1beta1.Coin { string denom = 1; string amount = 2 }` is the
// simplest non-trivial cross-chain message — used inside `MsgSend`,
// `MsgTransfer`, etc. We hand-encode the expected wire bytes and confirm
// our helpers produce the same.
// ---------------------------------------------------------------------------

describe('Coin message wire-format parity', () => {
  it('encodes Coin{denom: "uluna", amount: "1000000"}', () => {
    // Field 1 ("denom"): tag=0x0a, len=5, payload="uluna" = 75 6c 75 6e 61.
    // Field 2 ("amount"): tag=0x12, len=7, payload="1000000" = 31 30 30 30 30 30 30.
    const expected = '0a05756c756e611207313030303030'.concat('30')
    const actual = hex(
      concatBytes(protoString(1, 'uluna'), protoString(2, '1000000'))
    )
    expect(actual).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// Test-local varint decoder used to verify round-trips for values too big to
// hand-compute. Mirrors the standard varint algorithm in the inverse.
// ---------------------------------------------------------------------------

function decodeVarint(bytes: Uint8Array): bigint {
  let result = 0n
  let shift = 0n
  for (const byte of bytes) {
    result |= BigInt(byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return result
    shift += 7n
  }
  throw new Error('decodeVarint: unterminated varint')
}
