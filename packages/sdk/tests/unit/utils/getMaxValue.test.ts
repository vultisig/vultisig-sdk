import { getMaxValue } from '@core/chain/amount/getMaxValue'
import { describe, expect, it } from 'vitest'

describe('getMaxValue', () => {
  it('should return balance minus fee when balance exceeds fee', () => {
    expect(getMaxValue(1000n, 100n)).toBe(900n)
  })

  it('should return 0 when fee equals balance', () => {
    expect(getMaxValue(100n, 100n)).toBe(0n)
  })

  it('should return 0 when fee exceeds balance', () => {
    expect(getMaxValue(50n, 100n)).toBe(0n)
  })

  it('should handle zero balance', () => {
    expect(getMaxValue(0n, 100n)).toBe(0n)
  })

  it('should handle zero fee', () => {
    expect(getMaxValue(1000n, 0n)).toBe(1000n)
  })

  it('should handle large values (wei-scale)', () => {
    const balance = 5000000000000000000n // 5 ETH
    const fee = 21000000000000n // ~0.000021 ETH
    expect(getMaxValue(balance, fee)).toBe(4999979000000000000n)
  })
})
