import { describe, expect, it } from 'vitest'

import { assertBoundedInt } from './assertBoundedInt'

describe('assertBoundedInt', () => {
  it('returns the value unchanged when it fits the target range', () => {
    expect(assertBoundedInt('0', 'int64')).toBe('0')
    expect(assertBoundedInt('-1', 'int64')).toBe('-1')
    expect(assertBoundedInt('9223372036854775807', 'int64')).toBe('9223372036854775807')
    expect(assertBoundedInt('-9223372036854775808', 'int64')).toBe('-9223372036854775808')
    expect(assertBoundedInt('18446744073709551615', 'uint64')).toBe('18446744073709551615')
  })

  it('throws instead of allowing an int64 overflow that would wrap negative', () => {
    // 2^63 wraps to -2^63 via Long.fromString's two's-complement behavior.
    expect(() => assertBoundedInt('9223372036854775808', 'int64')).toThrow(/out of int64 range/)
  })

  it('throws instead of allowing a uint64 overflow that would wrap to a small value', () => {
    // 2^64 wraps to 0 via Long.fromString's two's-complement behavior.
    expect(() => assertBoundedInt('18446744073709551616', 'uint64')).toThrow(/out of uint64 range/)
  })

  it('rejects a negative value for uint64', () => {
    expect(() => assertBoundedInt('-1', 'uint64')).toThrow(/out of uint64 range/)
  })

  it('rejects non-integer / malformed input rather than coercing it', () => {
    expect(() => assertBoundedInt('', 'int64')).toThrow(/not a plain decimal integer string/)
    expect(() => assertBoundedInt('1.5', 'int64')).toThrow(/not a plain decimal integer string/)
    expect(() => assertBoundedInt('0x10', 'int64')).toThrow(/not a plain decimal integer string/)
    expect(() => assertBoundedInt('1e3', 'int64')).toThrow(/not a plain decimal integer string/)
    expect(() => assertBoundedInt('  1', 'int64')).toThrow(/not a plain decimal integer string/)
  })
})
