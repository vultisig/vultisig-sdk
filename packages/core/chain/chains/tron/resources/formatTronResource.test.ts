import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatTronResourceValue, formatTronWithdrawalTime, sunToTrx, trxToSun } from './formatTronResource'

describe('formatTronResourceValue', () => {
  it.each([
    [0, 0, '', '0/0'],
    [501, 999, 'E', '501/999'],
    [999, 1000, '', '1.00K/1.00K'],
    [1234, 5678, '', '1.23K/5.68K'],
    [1234, 5678, 'E', '1.23/5.68E'],
    [0, 1000, 'B', '0.00/1.00B'],
  ])('formats %s of %s with unit "%s"', (available, total, unit, expected) => {
    expect(formatTronResourceValue({ available, total, unit })).toBe(expected)
  })
})

describe('formatTronWithdrawalTime', () => {
  afterEach(() => vi.useRealTimers())
  it.each([
    [-1, 'ready_to_claim'],
    [0, 'ready_to_claim'],
    [1, '0h 0m'],
    [59_999, '0h 0m'],
    [60_000, '0h 1m'],
    [3_599_999, '0h 59m'],
    [3_600_000, '1h 0m'],
    [86_399_999, '23h 59m'],
    [86_400_000, '1d 0h'],
    [176_400_000, '2d 1h'],
  ])('formats %i milliseconds remaining', (remaining, expected) => {
    vi.useFakeTimers()
    vi.setSystemTime(1_700_000_000_000)
    expect(formatTronWithdrawalTime(1_700_000_000_000 + remaining)).toBe(expected)
  })
})

describe('SUN/TRX conversion', () => {
  it.each([
    [0n, 0],
    [1n, 0.000001],
    [1_234_567n, 1.234567],
    [-1n, -0.000001],
  ] as const)('converts %s SUN to %s TRX and back', (sun, trx) => {
    expect(sunToTrx(sun)).toBe(trx)
    expect(trxToSun(trx)).toBe(sun)
  })
  it.each([
    [0.00000049, 0n],
    [0.0000005, 1n],
    [1.2345674, 1_234_567n],
    [1.2345675, 1_234_568n],
  ] as const)('rounds %s TRX to %s SUN', (trx, expected) => expect(trxToSun(trx)).toBe(expected))
  it.each([NaN, Infinity, -Infinity])('rejects non-finite TRX %s', value => {
    expect(() => trxToSun(value)).toThrow(RangeError)
  })
})
