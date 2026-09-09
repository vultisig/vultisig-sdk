import { describe, expect, it } from 'vitest'

import { parseNonNegativeBigInt } from './parseNonNegativeBigInt'

describe('parseNonNegativeBigInt', () => {
  it.each(['', ' ', '\t\n', '1\n', ' 1', '1 ', '0x10', '0o10', '0b10', '+1', '-1', '-0', '1.5', '1e3'])(
    'rejects malformed amounts %j',
    value => expect(() => parseNonNegativeBigInt(value)).toThrow(/decimal/)
  )

  it.each([undefined, null, 0, 1n, {}, ['1']])('rejects non-string runtime inputs %s', value => {
    expect(() => parseNonNegativeBigInt(value as string)).toThrow(/decimal/)
  })

  it.each(['0', '00', '00123', '18446744073709551616', '340282366920938463463374607431768211455'])(
    'preserves valid arbitrary-precision amounts %s',
    value => expect(parseNonNegativeBigInt(value)).toBe(BigInt(value))
  )
})
