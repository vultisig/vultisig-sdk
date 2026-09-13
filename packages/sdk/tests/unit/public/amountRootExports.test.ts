import { describe, expect, it, vi } from 'vitest'

import {
  amount,
  AmountConvertError,
  convertAmount,
  cryptoToFiat,
  fiatToCrypto,
  MemoryStorage,
  toBaseUnits,
  toHumanUnits,
  Vultisig,
} from '@/index'

describe('public amount helpers', () => {
  it('preserves the canonical flat function references', () => {
    expect(amount).toEqual({ convert: convertAmount, toBaseUnits, toHumanUnits, fiatToCrypto, cryptoToFiat })
  })

  it('preserves exact precision, truncation and errors', () => {
    expect(amount.convert({ amount: '1.5', decimals: 18, direction: 'to_base' })).toBe('1500000000000000000')
    expect(amount.convert({ amount: '1500000000000000000', decimals: 18, direction: 'to_human' })).toBe('1.5')
    expect(amount.toBaseUnits('9007199254740993.123456789', 9)).toBe('9007199254740993123456789')
    expect(amount.toHumanUnits('9007199254740993123456789', 9)).toBe('9007199254740993.123456789')
    expect(amount.toBaseUnits('1.239', 2)).toBe('123')
    expect(() => amount.convert({ amount: 'invalid', decimals: 18, direction: 'to_base' })).toThrow(AmountConvertError)
    expect(amount.fiatToCrypto({ fiatValue: '100', price: '2000', decimals: 18 })).toBe('0.05')
    expect(amount.cryptoToFiat({ amount: '0.05', price: '2000' })).toBe('100')
  })

  it('is stable on instances and works without initialization, vaults or network', async () => {
    const sdk = new Vultisig({ autoInit: false, storage: new MemoryStorage() })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected network request'))
    try {
      expect(sdk.amount).toBe(amount)
      expect(sdk.amount).toBe(sdk.amount)
      expect(sdk.amount.convert({ amount: '1.5', decimals: 18, direction: 'to_base' })).toBe('1500000000000000000')
      expect(sdk.initialized).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      await sdk.dispose()
    }
  })
})
