import { describe, expect, it } from 'vitest'

import { Amount } from '../amount.js'
import { getAsset } from '../registry.js'

describe('Amount', () => {
  const btc = getAsset('btc')!
  const usdc = getAsset('usdc_eth')!
  const eth = getAsset('eth')!

  describe('creation', () => {
    it('should create from human string', () => {
      const amount = Amount.from('1.5', btc, 'native')
      expect(amount.toHuman()).toBe('1.5')
      expect(amount.asset.id).toBe('btc')
      expect(amount.layer).toBe('native')
    })

    it('should create from raw value', () => {
      const amount = Amount.fromRaw(150000000n, btc, 'native')
      expect(amount.toHuman()).toBe('1.5')
    })
  })

  describe('layer conversions', () => {
    it('should convert BTC native to THORChain', () => {
      const amount = Amount.from('1.0', btc, 'native')
      const thorchain = amount.toThorchain()

      expect(thorchain.layer).toBe('thorchain')
      expect(thorchain.raw).toBe(100000000n) // 1 BTC = 1e8 sats
    })

    it('should convert USDC native to THORChain', () => {
      const amount = Amount.from('100.0', usdc, 'native')
      const thorchain = amount.toThorchain()

      expect(thorchain.layer).toBe('thorchain')
      // USDC native 6 decimals -> THORChain 8 decimals: scale up by 2
      expect(thorchain.raw).toBe(10000000000n) // 100 * 1e8
    })

    it('should convert ETH native to FIN', () => {
      const amount = Amount.from('1.0', eth, 'native')
      const fin = amount.toFin()

      expect(fin.layer).toBe('fin')
      // ETH: 18 -> 8 -> 6 decimals through THORChain
      expect(fin.raw).toBe(1000000n) // 1 ETH in FIN precision
    })

    it('should handle round-trip conversions', () => {
      const original = Amount.from('123.456789', usdc, 'native')
      const roundTrip = original.toThorchain().toFin().toNative()

      // Should be close due to precision differences
      expect(Math.abs(parseFloat(original.toHuman()) - parseFloat(roundTrip.toHuman()))).toBeLessThan(0.01)
    })
  })

  describe('arithmetic', () => {
    it('should add amounts of same asset and layer', () => {
      const amount1 = Amount.from('1.5', btc, 'native')
      const amount2 = Amount.from('2.3', btc, 'native')
      const sum = amount1.add(amount2)

      expect(sum.toHuman()).toBe('3.8')
    })

    it('should subtract amounts', () => {
      const amount1 = Amount.from('5.0', btc, 'native')
      const amount2 = Amount.from('2.0', btc, 'native')
      const diff = amount1.subtract(amount2)

      expect(diff.toHuman()).toBe('3')
    })

    it('should multiply by factor', () => {
      const amount = Amount.from('2.0', btc, 'native')
      const doubled = amount.multiply(2)

      expect(doubled.toHuman()).toBe('4')
    })
  })

  describe('display', () => {
    it('should display with asset symbol', () => {
      const amount = Amount.from('123.45', usdc, 'native')
      expect(amount.toDisplay()).toBe('123.45 USDC_ETH')
    })

    it('should format with precision', () => {
      const amount = Amount.from('123.456789', usdc, 'native')
      expect(amount.toHuman(2)).toBe('123.45')
    })
  })

  describe('comparisons', () => {
    it('should check equality', () => {
      const amount1 = Amount.from('1.0', btc, 'native')
      const amount2 = Amount.from('1.0', btc, 'native')
      const amount3 = Amount.from('1.0', usdc, 'native')

      expect(amount1.equals(amount2)).toBe(true)
      expect(amount1.equals(amount3)).toBe(false)
    })

    it('should check if positive', () => {
      const positive = Amount.from('1.0', btc, 'native')
      const zero = Amount.from('0', btc, 'native')

      expect(positive.isPositive()).toBe(true)
      expect(zero.isZero()).toBe(true)
      expect(zero.isPositive()).toBe(false)
    })
  })
})
