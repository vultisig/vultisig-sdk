import { describe, expect, it } from 'vitest'

import { getCoinValue } from './getCoinValue'

describe('getCoinValue', () => {
  it('calculates ordinary fiat values', () => {
    expect(getCoinValue({ amount: 1500000n, decimals: 6, price: 2 })).toBe(3)
    expect(getCoinValue({ amount: -1500000n, decimals: 6, price: 2 })).toBe(-3)
  })

  it('converts base units exactly before entering number-based fiat math', () => {
    const amount = 831048943873725519n

    expect(Number(amount) / 10 ** 6).toBe(831048943873.7256)
    expect(getCoinValue({ amount, decimals: 6, price: 1 })).toBe(831048943873.7255)
  })
})
