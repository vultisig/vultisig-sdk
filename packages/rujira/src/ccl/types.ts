export type CclModel = 'quadratic' | 'linear'

export type CclRangeConfig = {
  high: number
  low: number
  price: number
  sigma: number
  spread: number
  delta: number
  model?: CclModel
}

export type CclDistributionBucket = {
  pStart: number
  pEnd: number
  pMid: number
  weight: number
  pct: number
  side: 'ask' | 'bid'
}

export type CclDistribution = {
  asks: CclDistributionBucket[]
  bids: CclDistributionBucket[]
  price: number
  askPrice: number
  bidPrice: number
  avgAskFillPrice: number
  avgBidFillPrice: number
  balanceRatio: number | null
}
