import type { Ccl } from './base.js'
import { CclLinear } from './linear.js'
import { CclQuadratic } from './quadratic.js'
import type { CclDistribution, CclDistributionBucket, CclModel, CclRangeConfig } from './types.js'

export function createCcl(high: number, low: number, sigma: number, model: CclModel = 'linear'): Ccl {
  return model === 'quadratic' ? new CclQuadratic(high, low, sigma) : new CclLinear(high, low, sigma)
}

// Generates distribution using geometric (delta-based) stepping matching Rust RangeOfferIter
export function generateCclDistribution(config: CclRangeConfig): CclDistribution {
  const { high, low, price, sigma, spread, delta, model } = config

  const empty: CclDistribution = {
    asks: [],
    bids: [],
    price: 0,
    askPrice: 0,
    bidPrice: 0,
    avgAskFillPrice: 0,
    avgBidFillPrice: 0,
    balanceRatio: null,
  }

  if (
    ![high, low, price, sigma, spread, delta].every(Number.isFinite) ||
    high <= low ||
    low <= 0 ||
    price <= 0 ||
    spread < 0 ||
    spread >= 1 ||
    delta <= 0
  ) {
    return empty
  }

  const ccl = createCcl(high, low, sigma, model)
  const askPrice = ccl.ask(price, spread)
  const bidPrice = ccl.bid(price, spread)

  const asks: CclDistributionBucket[] = []
  const bids: CclDistributionBucket[] = []
  let askWeight = 0
  let bidWeight = 0

  // Asks: geometric steps ascending from askPrice to high
  let p = askPrice
  while (p < high) {
    const next = Math.min(p + p * delta, high)
    if (next <= p) break
    const pMid = (p + next) / 2
    const w = Math.max(0, ccl.weight(pMid))
    asks.push({ pStart: p, pEnd: next, pMid, weight: w, pct: 0, side: 'ask' })
    askWeight += w
    p = next
  }

  // Bids: geometric steps descending from bidPrice to low
  p = bidPrice
  while (p > low) {
    const next = Math.max(p - p * delta, low)

    if (next <= 0 || next >= p) break
    const pMid = (next + p) / 2
    const w = Math.max(0, ccl.weight(pMid))
    bids.push({ pStart: next, pEnd: p, pMid, weight: w, pct: 0, side: 'bid' })
    bidWeight += w
    p = next
  }

  if (askWeight > 0) {
    for (const bucket of asks) {
      bucket.pct = (bucket.weight / askWeight) * 100
    }
  }
  if (bidWeight > 0) {
    for (const bucket of bids) {
      bucket.pct = (bucket.weight / bidWeight) * 100
    }
  }

  const avgAskFillPrice = askWeight > 0 ? asks.reduce((sum, b) => sum + b.pMid * b.weight, 0) / askWeight : 0
  const avgBidFillPrice = bidWeight > 0 ? bids.reduce((sum, b) => sum + b.pMid * b.weight, 0) / bidWeight : 0

  const balanceRatio = ccl.balanceRatio(price)

  return { asks, bids, price, askPrice, bidPrice, avgAskFillPrice, avgBidFillPrice, balanceRatio }
}
