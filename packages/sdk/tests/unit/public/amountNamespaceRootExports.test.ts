import { describe, expect, it } from 'vitest'

import { amount, convertAmount, cryptoToFiat, fiatToCrypto, toBaseUnits, toHumanUnits } from '@/index'
import { amount as amountFromUtils } from '@/utils/convertAmount'

describe('SDK root amount namespace', () => {
  it('exposes the amount helper family without removing flat exports', () => {
    expect(amount).toBe(amountFromUtils)
    expect(amount.convert).toBe(convertAmount)
    expect(amount.toBaseUnits).toBe(toBaseUnits)
    expect(amount.toHumanUnits).toBe(toHumanUnits)
    expect(amount.fiatToCrypto).toBe(fiatToCrypto)
    expect(amount.cryptoToFiat).toBe(cryptoToFiat)
  })

  it('sdk.amount.convert produces the same result as convertAmount', () => {
    const params = { amount: '1.5', decimals: 18, direction: 'to_base' as const }
    expect(amount.convert(params)).toBe(convertAmount(params))
    expect(amount.convert(params)).toBe('1500000000000000000')
  })

  it('sdk.amount.toBaseUnits / toHumanUnits round-trip matches the flat helpers', () => {
    expect(amount.toBaseUnits('100', 6)).toBe(toBaseUnits('100', 6))
    expect(amount.toHumanUnits('100000000', 6)).toBe(toHumanUnits('100000000', 6))
  })

  it('sdk.amount.fiatToCrypto / cryptoToFiat match the flat helpers', () => {
    expect(amount.fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 })).toBe(
      fiatToCrypto({ fiatValue: 100, price: 2000, decimals: 18 })
    )
    expect(amount.cryptoToFiat({ amount: 0.05, price: 2000 })).toBe(cryptoToFiat({ amount: 0.05, price: 2000 }))
  })
})
