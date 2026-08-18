import { describe, expect, it } from 'vitest'

import { kaminoRateEquals, parseKaminoRate, renderKaminoRate, sumKaminoRates } from './rate'

describe('parseKaminoRate', () => {
  it('parses exactly without going through floating point', () => {
    const rate = parseKaminoRate('1.0536041812651029025')
    expect(rate).toEqual({ numerator: 10536041812651029025n, scale: 19 })

    // Past any fixed-precision significand, where a float- or decimal-backed
    // rate would silently round.
    const long = parseKaminoRate('19929400626900.66071158913974817848691057')
    expect(long).toEqual({ numerator: 1992940062690066071158913974817848691057n, scale: 26 })
  })

  it('rejects the same formatting the decimal validator does', () => {
    expect(parseKaminoRate('1,053.60')).toBeUndefined()
    expect(parseKaminoRate('1e-5')).toBeUndefined()
    expect(parseKaminoRate('')).toBeUndefined()
  })

  it('handles fraction-only and negative forms', () => {
    expect(parseKaminoRate('.5')).toEqual({ numerator: 5n, scale: 1 })
    expect(parseKaminoRate('-0.5')).toEqual({ numerator: -5n, scale: 1 })
  })
})

describe('sumKaminoRates', () => {
  it('adds at the reported precision, not a truncated one', () => {
    // Truncating these to 6 decimals first and adding misses the true total by
    // one base unit; at full precision the identity holds exactly.
    const sum = sumKaminoRates('0.9445485', '0.9595935')
    expect(sum).toBeDefined()
    expect(kaminoRateEquals(sum!, '1.904142')).toBe(true)
  })

  it('refuses unreadable inputs', () => {
    expect(sumKaminoRates('1,0', '2')).toBeUndefined()
  })
})

describe('kaminoRateEquals', () => {
  it('compares across scales', () => {
    const rate = parseKaminoRate('1.50')
    expect(kaminoRateEquals(rate!, '1.5')).toBe(true)
    expect(kaminoRateEquals(rate!, '1.5000')).toBe(true)
    expect(kaminoRateEquals(rate!, '1.5001')).toBe(false)
  })

  it('an unreadable figure is never equal to a readable one', () => {
    const rate = parseKaminoRate('1.5')
    expect(kaminoRateEquals(rate!, '1,5')).toBe(false)
  })
})

describe('renderKaminoRate', () => {
  it('round-trips to the plain decimal form without trailing zeros', () => {
    expect(renderKaminoRate(parseKaminoRate('1.0536041812651029025')!)).toBe('1.0536041812651029025')
    expect(renderKaminoRate(parseKaminoRate('1.50')!)).toBe('1.5')
    expect(renderKaminoRate(parseKaminoRate('0')!)).toBe('0')
  })
})
