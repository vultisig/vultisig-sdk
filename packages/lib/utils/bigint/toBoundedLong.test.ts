import Long from 'long'
import { describe, expect, it } from 'vitest'

import { toBoundedLong } from './toBoundedLong'

const SIGNED_MAX = 2n ** 63n - 1n
const SIGNED_MIN = -(2n ** 63n)
const UNSIGNED_MAX = 2n ** 64n - 1n

describe('toBoundedLong', () => {
  it('passes an in-range signed value through unchanged', () => {
    expect(toBoundedLong('123456789', { unsigned: false }).toString()).toBe('123456789')
    expect(toBoundedLong(SIGNED_MAX, { unsigned: false }).toString()).toBe(SIGNED_MAX.toString())
    expect(toBoundedLong(SIGNED_MIN, { unsigned: false }).toString()).toBe(SIGNED_MIN.toString())
  })

  it('throws for a signed value one above the 2^63-1 ceiling', () => {
    expect(() => toBoundedLong(SIGNED_MAX + 1n, { unsigned: false })).toThrow(RangeError)
  })

  it('throws for a signed value one below the -2^63 floor', () => {
    expect(() => toBoundedLong(SIGNED_MIN - 1n, { unsigned: false })).toThrow(RangeError)
  })

  it('passes an unsigned value at exactly 2^64-1', () => {
    const result = toBoundedLong(UNSIGNED_MAX, { unsigned: true })
    expect(result.unsigned).toBe(true)
    expect(result.toString()).toBe(UNSIGNED_MAX.toString())
  })

  it('throws for an unsigned value at 2^64', () => {
    expect(() => toBoundedLong(UNSIGNED_MAX + 1n, { unsigned: true })).toThrow(RangeError)
  })

  it('rejects a negative value in unsigned mode', () => {
    expect(() => toBoundedLong(-1n, { unsigned: true })).toThrow(RangeError)
  })

  it('does NOT silently wrap where raw Long.fromString would', () => {
    // Raw Long.fromString silently wraps these; the guard must reject instead.
    expect(Long.fromString((UNSIGNED_MAX + 1n).toString(), true).toString()).toBe('0')
    expect(() => toBoundedLong((UNSIGNED_MAX + 1n).toString(), { unsigned: true })).toThrow(RangeError)
    expect(Long.fromString((SIGNED_MAX + 1n).toString(), false).toString()).toBe(SIGNED_MIN.toString())
    expect(() => toBoundedLong((SIGNED_MAX + 1n).toString(), { unsigned: false })).toThrow(RangeError)
  })

  it('accepts both bigint and string inputs equivalently', () => {
    expect(toBoundedLong('42', { unsigned: false }).toString()).toBe(toBoundedLong(42n, { unsigned: false }).toString())
  })
})
