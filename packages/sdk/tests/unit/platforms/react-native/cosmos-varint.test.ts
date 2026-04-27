/**
 * Regression tests for the bound-checked `varint` helper inside the RN cosmos
 * tx builder (CR item #7).
 *
 * The previous implementation used `n >>>= 7` to shift bits between iterations,
 * which silently truncates `n` to 32 bits. Any value above 2^32-1 was encoded
 * to a varint that decodes to a different number — corrupting protobuf
 * length prefixes and field tags downstream. The fix adds an explicit bound
 * check (`!Number.isInteger(n) || n < 0 || n > 0xffffffff` → throw).
 */
import { describe, expect, it } from 'vitest'

import { varintForTesting as varint } from '../../../../src/platforms/react-native/chains/cosmos/tx'

describe('cosmos / varint bound checks', () => {
  it('encodes 0 as a single zero byte', () => {
    expect(Array.from(varint(0))).toEqual([0])
  })

  it('encodes small ints (single byte) correctly', () => {
    expect(Array.from(varint(1))).toEqual([1])
    expect(Array.from(varint(127))).toEqual([0x7f])
  })

  it('encodes 128 as the canonical 2-byte varint [0x80, 0x01]', () => {
    // The 128 boundary is the first multi-byte varint and a common source of
    // off-by-one bugs (continuation bit MUST be set on the first byte). Pin
    // this to catch any regression in the encoder's boundary handling.
    expect(Array.from(varint(128))).toEqual([0x80, 0x01])
  })

  it('encodes 2^32-1 (max uint32) as a 5-byte varint', () => {
    // 2^32-1 = 4294967295 → varint = ff ff ff ff 0f
    expect(Array.from(varint(0xffffffff))).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f])
  })

  it('throws on 2^33 (above 32-bit boundary)', () => {
    // The pre-fix code would silently encode this as `0` because `n >>>= 7`
    // truncates the value to 0 after the first shift; the resulting protobuf
    // body would be missing the length prefix entirely.
    expect(() => varint(2 ** 33)).toThrow(/value out of range/)
  })

  it('throws on Number.MAX_SAFE_INTEGER', () => {
    expect(() => varint(Number.MAX_SAFE_INTEGER)).toThrow(/value out of range/)
  })

  it('throws on negative numbers', () => {
    expect(() => varint(-1)).toThrow(/value out of range/)
  })

  it('throws on non-integer (NaN)', () => {
    expect(() => varint(NaN)).toThrow(/value out of range/)
  })

  it('throws on non-integer (Infinity)', () => {
    expect(() => varint(Infinity)).toThrow(/value out of range/)
  })

  it('throws on fractional input', () => {
    expect(() => varint(1.5)).toThrow(/value out of range/)
  })
})
