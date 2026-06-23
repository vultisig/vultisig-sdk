import { describe, expect, it } from 'vitest'

import {
  formatPrice18,
  getSqrtRatioAtTick,
  MAX_TICK,
  priceToTick,
  roundTickDown,
  roundTickUp,
  sqrtPriceToPriceMantissa,
  tickToPriceMantissa,
  UNI_V3_TICK_SPACING,
} from '@/tools/dex/uniswap/tickMath'

describe('uniswap v3 tick math', () => {
  describe('getSqrtRatioAtTick', () => {
    it('returns Q96 (2^96) at tick 0', () => {
      // 1.0001^0 = 1 → sqrtPriceX96 = 1 * 2^96
      expect(getSqrtRatioAtTick(0)).toBe(2n ** 96n)
    })

    it('matches the canonical V3 boundary value at MIN_TICK', () => {
      // TickMath.getSqrtRatioAtTick(MIN_TICK) per v3-core (well-known constant).
      expect(getSqrtRatioAtTick(-MAX_TICK)).toBe(4295128739n)
    })

    it('matches the canonical V3 boundary value at MAX_TICK', () => {
      expect(getSqrtRatioAtTick(MAX_TICK)).toBe(1461446703485210103287273052203988822378723970342n)
    })

    it('is symmetric: sqrt(+t) * sqrt(-t) ≈ Q192', () => {
      const t = 60000
      const up = getSqrtRatioAtTick(t)
      const down = getSqrtRatioAtTick(-t)
      const product = up * down
      const q192 = 2n ** 192n
      // Within a tiny rounding band (the contract rounds the Q128.128→Q96 shift up).
      const diff = product > q192 ? product - q192 : q192 - product
      expect(diff < q192 / 10n ** 12n).toBe(true)
    })

    it('throws when |tick| exceeds MAX_TICK', () => {
      expect(() => getSqrtRatioAtTick(MAX_TICK + 1)).toThrow(/out of range/)
    })
  })

  describe('tick <-> price round-trip', () => {
    it('round-trips a USDC(6)/WETH(18) tick through price and back', () => {
      // A representative ETH-priced tick. priceToTick(tickToPrice(t)) === t.
      const tick = 200697
      const { mantissa, scale } = tickToPriceMantissa(tick, 6, 18)
      const priceStr = formatPrice18(mantissa, scale)
      const price = Number(priceStr)
      expect(price).toBeGreaterThan(0)
      expect(priceToTick(price, 6, 18)).toBe(tick)
    })
  })

  describe('sqrtPriceToPriceMantissa', () => {
    it('returns price 1 for sqrtPriceX96 = 2^96 with equal decimals', () => {
      const { mantissa, scale } = sqrtPriceToPriceMantissa(2n ** 96n, 18, 18)
      expect(formatPrice18(mantissa, scale)).toBe('1')
    })

    it('returns 0 for a zero sqrt price', () => {
      const { mantissa, scale } = sqrtPriceToPriceMantissa(0n, 6, 18)
      expect(formatPrice18(mantissa, scale)).toBe('0')
    })
  })

  describe('formatPrice18 (Go big.Float.Text("g", 18) parity)', () => {
    it('renders whole numbers without a decimal point', () => {
      // 1234 * 10^0
      expect(formatPrice18(1234n, 0)).toBe('1234')
    })
    it('strips trailing fractional zeros', () => {
      // 1.5 → mantissa 15, scale 1
      expect(formatPrice18(15n, 1)).toBe('1.5')
    })
    it('switches to exponential below the -4 threshold', () => {
      // 4.38e-5 → mantissa 438, scale 7
      expect(formatPrice18(438n, 7)).toBe('4.38e-5')
    })
  })

  describe('tick spacing rounding', () => {
    it('exposes canonical fee-tier spacings', () => {
      expect(UNI_V3_TICK_SPACING[500]).toBe(10)
      expect(UNI_V3_TICK_SPACING[3000]).toBe(60)
    })
    it('rounds down and up to the nearest valid tick', () => {
      expect(roundTickDown(205, 60)).toBe(180)
      expect(roundTickUp(205, 60)).toBe(240)
      expect(roundTickDown(-205, 60)).toBe(-240)
      expect(roundTickUp(-205, 60)).toBe(-180)
    })
    it('leaves aligned ticks untouched', () => {
      expect(roundTickDown(180, 60)).toBe(180)
      expect(roundTickUp(180, 60)).toBe(180)
    })
  })

  describe('priceToTick validation', () => {
    it('rejects non-positive prices', () => {
      expect(() => priceToTick(0, 6, 18)).toThrow(/positive finite/)
      expect(() => priceToTick(-1, 6, 18)).toThrow(/positive finite/)
    })
  })
})
