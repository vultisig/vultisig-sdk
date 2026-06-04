import { describe, expect, it } from 'vitest'

import { fromChainAmount } from './fromChainAmount'
import { ChainAmountParseError, toChainAmount } from './toChainAmount'

describe('toChainAmount', () => {
  it('converts integer amounts using parseUnits semantics', () => {
    expect(toChainAmount(1, 18)).toBe(1_000_000_000_000_000_000n)
    expect(toChainAmount(0, 8)).toBe(0n)
  })

  it('handles fractional strings without scientific notation when possible', () => {
    expect(toChainAmount(1.5, 1)).toBe(15n)
    expect(toChainAmount(0.1, 18)).toBe(100_000_000_000_000_000n)
  })

  it('normalizes scientific notation via toFixed before parsing', () => {
    // 1e-8 tokens at 10^-10 resolution → 100 smallest units (matches viem parseUnits)
    expect(toChainAmount(1e-8, 10)).toBe(100n)
  })

  it('parses scientific-notation strings without floating-point mantissa loss', () => {
    expect(toChainAmount('1e-8', 10)).toBe(toChainAmount('0.00000001', 10))
    expect(toChainAmount('12.34e2', 3)).toBe(toChainAmount('1234', 3))
    expect(toChainAmount('.5e1', 1)).toBe(toChainAmount(5, 1))
    expect(toChainAmount('012.34e-1', 4)).toBe(toChainAmount('1.234', 4))
    const plain = `1.${'0'.repeat(16)}1`
    expect(toChainAmount(`${plain}e0`, 18)).toBe(toChainAmount(plain, 18))
  })
})

describe('fromChainAmount', () => {
  it('divides bigint base units by 10^decimals', () => {
    expect(fromChainAmount(1_000_000n, 6)).toBe(1)
    expect(fromChainAmount(1n, 0)).toBe(1)
  })

  it('accepts numeric and string inputs coerced like Number()', () => {
    expect(fromChainAmount('5000000', 6)).toBe(5)
    expect(fromChainAmount(2_000_000_000, 9)).toBe(2)
  })
})

// Amount-shape backstop (agent-backend prompt-skills refactor): toChainAmount is
// the SDK's execution-layer base-unit converter. The agent-backend prompt prose
// that warns the model never to feed it junk/whitespace amounts can be deleted
// only if this layer rejects those shapes deterministically. Pin that contract so
// a future viem bump can't silently start coercing junk into a wrong magnitude.
describe('toChainAmount — junk/whitespace rejection (prompt-prose backstop)', () => {
  it('rejects an empty / whitespace-only amount', () => {
    expect(() => toChainAmount('', 6)).toThrow(ChainAmountParseError)
    expect(() => toChainAmount('   ', 6)).toThrow(ChainAmountParseError)
  })

  it('rejects trailing alpha junk (never coerces "10xyz" to 10)', () => {
    expect(() => toChainAmount('10xyz', 6)).toThrow()
    expect(() => toChainAmount('0.5abc', 18)).toThrow()
  })

  it('rejects thousands-separator commas at the base-unit layer', () => {
    // mcp-ts parseAmount strips grouping ("1,000"->"1000") BEFORE this layer;
    // the raw grouped string must never reach toChainAmount and be mis-scaled.
    expect(() => toChainAmount('1,000', 6)).toThrow()
  })

  it('rejects interior whitespace ("1 0" is not 10)', () => {
    expect(() => toChainAmount('1 0', 6)).toThrow()
  })
})
