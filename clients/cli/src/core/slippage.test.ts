import { describe, expect, it } from 'vitest'

import { InvalidInputError } from './errors'
import { parseSlippagePercent } from './slippage'

describe('parseSlippagePercent', () => {
  it.each(['', '   ', '51', 'abc'])('rejects invalid input %j', raw => {
    expect(() => parseSlippagePercent(raw)).toThrow(InvalidInputError)
  })

  it.each([
    ['1', 1],
    ['0', 0],
    ['50', 50],
  ] as const)('parses %j as %s', (raw, expected) => {
    expect(parseSlippagePercent(raw)).toBe(expected)
  })
})
