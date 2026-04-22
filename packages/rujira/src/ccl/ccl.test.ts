import { describe, expect, it } from 'vitest'

import { Ccl } from './base.js'
import { createCcl, generateCclDistribution } from './ccl.js'
import { CclLinear } from './linear.js'
import { CclQuadratic } from './quadratic.js'
import type { CclModel, CclRangeConfig } from './types.js'

const models: { name: CclModel; create: (h: number, l: number, s: number) => Ccl }[] = [
  { name: 'quadratic', create: (h, l, s) => new CclQuadratic(h, l, s) },
  { name: 'linear', create: (h, l, s) => new CclLinear(h, l, s) },
]

// ============================================================
// Shared base class behavior — runs against BOTH models
// ============================================================
describe.each(models)('Ccl base [$name]', ({ create }) => {
  describe('price', () => {
    it('returns low when quote=0', () => {
      const ccl = create(4000, 3000, 0)
      expect(ccl.price(100000, 0)).toBeCloseTo(3000, 0)
    })

    it('returns high when base=0', () => {
      const ccl = create(4000, 3000, 0)
      expect(ccl.price(0, 401992761)).toBeCloseTo(4000, 0)
    })

    it('stays within [low, high] for all skew values', () => {
      const cases: [number, number, number][] = [
        [0.9, 100, 1000000],
        [-0.9, 100, 1000000],
        [0.5, 1000000, 1],
        [0.99, 500000, 500000],
        [-0.99, 500000, 500000],
      ]
      for (const [sigma, b, q] of cases) {
        const ccl = create(4, 3, sigma)
        const price = ccl.price(b, q)
        expect(price).toBeGreaterThanOrEqual(3)
        expect(price).toBeLessThanOrEqual(4)
      }
    })
  })

  describe('ask / bid', () => {
    it('ask = price + price * spread', () => {
      const ccl = create(4, 3, 0)
      const price = 3.5
      const spread = 0.01
      expect(ccl.ask(price, spread)).toBeCloseTo(price + (price * spread) / 2)
    })

    it('bid = price - price * spread', () => {
      const ccl = create(4, 3, 0)
      const price = 3.5
      const spread = 0.01
      expect(ccl.bid(price, spread)).toBeCloseTo(price - (price * spread) / 2)
    })

    it('bid floors at 0', () => {
      const ccl = create(4, 3, 0)
      expect(ccl.bid(0.01, 2)).toBe(0)
    })

    it('ask returns price between center and high', () => {
      const ccl = create(4, 3, 0)
      const base = 100000000
      const quote = 401992761
      const price = ccl.price(base, quote)
      const askPrice = ccl.ask(price, 0.01)
      expect(askPrice).toBeGreaterThan(price)
    })

    it('bid returns price between low and center', () => {
      const ccl = create(4, 3, 0)
      const base = 100000000
      const quote = 401992761
      const price = ccl.price(base, quote)
      const bidPrice = ccl.bid(price, 0.01)
      expect(bidPrice).toBeLessThan(price)
      expect(bidPrice).toBeGreaterThanOrEqual(0)
    })
  })

  describe('balanceRatio', () => {
    it('returns positive ratio at mid-range price', () => {
      const ccl = create(4, 3, 0)
      const ratio = ccl.balanceRatio(3.5)
      expect(ratio).not.toBeNull()
      expect(ratio!).toBeGreaterThan(0)
    })

    it('returns null at upper bound (x=0)', () => {
      const ccl = create(4, 3, 0)
      expect(ccl.balanceRatio(4)).toBeNull()
    })

    it('ratio increases as price moves toward high', () => {
      const ccl = create(4, 3, 0)
      const ratioLow = ccl.balanceRatio(3.2)!
      const ratioHigh = ccl.balanceRatio(3.8)!
      expect(ratioHigh).toBeGreaterThan(ratioLow)
    })
  })
})

// ============================================================
// Roundtrip: balanceRatio(p) → price(base, quote) ≈ p
// ============================================================
describe.each(models)('balanceRatio roundtrip [$name]', ({ create }) => {
  const prices = [3.2, 3.5, 3.8]
  const sigmas = [0, 0.5, -0.5, 0.8, -0.8]
  const base = 100_000_000

  it.each(sigmas.flatMap(s => prices.map(p => ({ s, p }))))('σ=$s p=$p → quoted price matches', ({ s, p }) => {
    const ccl = create(4, 3, s)
    const ratio = ccl.balanceRatio(p)!
    expect(ratio).not.toBeNull()
    const quote = Math.round(base * ratio)
    const quoted = ccl.price(base, quote)
    expect(quoted).toBeCloseTo(p, 4)
  })
})

// ============================================================
// Rust reference values
// ============================================================
describe('CclQuadratic price reference', () => {
  it('computes price matching Rust cl_pricing test', () => {
    const ccl = new CclQuadratic(4000, 3000, 0)
    const price = ccl.price(100000, 401992761)
    expect(price).toBeGreaterThanOrEqual(3499)
    expect(price).toBeLessThanOrEqual(3501)
  })
})

// ============================================================
// createCcl factory
// ============================================================
describe('createCcl factory', () => {
  it('defaults to linear', () => {
    expect(createCcl(4, 3, 0)).toBeInstanceOf(CclLinear)
  })

  it('creates quadratic when specified', () => {
    expect(createCcl(4, 3, 0, 'quadratic')).toBeInstanceOf(CclQuadratic)
  })

  it('creates linear when specified', () => {
    expect(createCcl(4, 3, 0, 'linear')).toBeInstanceOf(CclLinear)
  })
})

// ============================================================
// generateCclDistribution — delta-based stepping
// ============================================================
describe.each(models.map(m => m.name))('generateCclDistribution [%s]', model => {
  const baseConfig: CclRangeConfig = {
    high: 4,
    low: 3,
    price: 3.5,
    sigma: 0,
    spread: 0.01,
    delta: 0.05,
    model,
  }

  it('mid price equals provided price', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.price).toBe(3.5)
  })

  it('returns buckets that sum to 100%', () => {
    const dist = generateCclDistribution(baseConfig)
    const askSum = dist.asks.reduce((s, b) => s + b.pct, 0)
    const bidSum = dist.bids.reduce((s, b) => s + b.pct, 0)
    expect(askSum).toBeCloseTo(100, 1)
    expect(bidSum).toBeCloseTo(100, 1)
  })

  it('ask buckets cover [askPrice, high]', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.asks.length).toBeGreaterThan(0)
    expect(dist.asks[0].pStart).toBeCloseTo(dist.askPrice, 6)
    expect(dist.asks[dist.asks.length - 1].pEnd).toBeCloseTo(4, 6)
  })

  it('bid buckets cover [low, bidPrice]', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.bids.length).toBeGreaterThan(0)
    // bids are ordered descending (first bucket is closest to spread)
    expect(dist.bids[dist.bids.length - 1].pStart).toBeCloseTo(3, 1)
    expect(dist.bids[0].pEnd).toBeCloseTo(dist.bidPrice, 6)
  })

  it('geometric steps: each ask bucket is wider than the previous', () => {
    const dist = generateCclDistribution({ ...baseConfig, delta: 0.05 })
    for (let i = 1; i < dist.asks.length - 1; i++) {
      const prevWidth = dist.asks[i - 1].pEnd - dist.asks[i - 1].pStart
      const currWidth = dist.asks[i].pEnd - dist.asks[i].pStart
      expect(currWidth).toBeGreaterThanOrEqual(prevWidth - 1e-10)
    }
  })

  it('σ=0 produces uniform distribution', () => {
    const dist = generateCclDistribution(baseConfig)
    const allBuckets = [...dist.asks, ...dist.bids]
    const weights = allBuckets.map(b => b.weight)
    const avg = weights.reduce((s, w) => s + w, 0) / weights.length
    for (const w of weights) {
      expect(w).toBeCloseTo(avg, 1)
    }
  })

  it('returns empty for invalid inputs', () => {
    const dist = generateCclDistribution({ ...baseConfig, high: 2, low: 3 })
    expect(dist.asks).toHaveLength(0)
    expect(dist.bids).toHaveLength(0)
  })

  it('returns empty for delta=0', () => {
    const dist = generateCclDistribution({ ...baseConfig, delta: 0 })
    expect(dist.asks).toHaveLength(0)
  })

  it('avgAskFillPrice is between askPrice and high', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.avgAskFillPrice).toBeGreaterThanOrEqual(dist.askPrice)
    expect(dist.avgAskFillPrice).toBeLessThanOrEqual(baseConfig.high)
  })

  it('avgBidFillPrice is between low and bidPrice', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.avgBidFillPrice).toBeGreaterThanOrEqual(baseConfig.low)
    expect(dist.avgBidFillPrice).toBeLessThanOrEqual(dist.bidPrice)
  })

  it('avgAskFillPrice and avgBidFillPrice are 0 for invalid inputs', () => {
    const dist = generateCclDistribution({ ...baseConfig, high: 2, low: 3 })
    expect(dist.avgAskFillPrice).toBe(0)
    expect(dist.avgBidFillPrice).toBe(0)
  })

  it('σ=0 avgAskFillPrice is near midpoint of ask range', () => {
    const dist = generateCclDistribution(baseConfig)
    const expectedMid = (dist.askPrice + baseConfig.high) / 2
    expect(dist.avgAskFillPrice).toBeCloseTo(expectedMid, 1)
  })

  it('σ=0 avgBidFillPrice is near midpoint of bid range', () => {
    const dist = generateCclDistribution(baseConfig)
    const expectedMid = (baseConfig.low + dist.bidPrice) / 2
    expect(dist.avgBidFillPrice).toBeCloseTo(expectedMid, 1)
  })

  it('balanceRatio roundtrips to price', () => {
    const dist = generateCclDistribution(baseConfig)
    expect(dist.balanceRatio).not.toBeNull()
    const ccl = createCcl(4, 3, 0, model)
    const base = 1e8
    const quote = Math.round(base * dist.balanceRatio!)
    expect(ccl.price(base, quote)).toBeCloseTo(3.5, 4)
  })

  it('smaller delta produces more buckets', () => {
    const distSmall = generateCclDistribution({ ...baseConfig, delta: 0.01 })
    const distLarge = generateCclDistribution({ ...baseConfig, delta: 0.1 })
    const smallTotal = distSmall.asks.length + distSmall.bids.length
    const largeTotal = distLarge.asks.length + distLarge.bids.length
    expect(smallTotal).toBeGreaterThan(largeTotal)
  })
})

// ============================================================
// Distribution skew behavior
// ============================================================
describe('distribution skew (quadratic — symmetric)', () => {
  const cfg: CclRangeConfig = {
    high: 4,
    low: 3,
    price: 3.5,
    sigma: 0,
    spread: 0.01,
    delta: 0.05,
    model: 'quadratic',
  }

  it('σ>0 concentrates asks near spread', () => {
    const dist = generateCclDistribution({ ...cfg, sigma: 0.8 })
    const asks = dist.asks
    expect(asks[0].pct).toBeGreaterThan(asks[asks.length - 1].pct)
  })

  it('σ<0 concentrates asks near edge', () => {
    const dist = generateCclDistribution({ ...cfg, sigma: -0.8 })
    const asks = dist.asks
    expect(asks[asks.length - 1].pct).toBeGreaterThan(asks[0].pct)
  })
})

describe('distribution skew (linear — directional)', () => {
  const cfg: CclRangeConfig = {
    high: 4,
    low: 3,
    price: 3.5,
    sigma: 0,
    spread: 0.01,
    delta: 0.05,
    model: 'linear',
  }

  it('σ>0 concentrates asks toward high', () => {
    const dist = generateCclDistribution({ ...cfg, sigma: 0.8 })
    const asks = dist.asks
    expect(asks[asks.length - 1].pct).toBeGreaterThan(asks[0].pct)
  })

  it('σ<0 concentrates asks toward low (near spread)', () => {
    const dist = generateCclDistribution({ ...cfg, sigma: -0.8 })
    const asks = dist.asks
    expect(asks[0].pct).toBeGreaterThan(asks[asks.length - 1].pct)
  })
})
