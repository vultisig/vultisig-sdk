import type { Chain } from '@vultisig/core-chain/Chain'

/** Token metadata (SDK-owned, decoupled from core's KnownCoin) */
export type TokenInfo = {
  chain: Chain
  contractAddress?: string
  ticker: string
  decimals: number
  logo?: string
  priceProviderId?: string
}

/** Native fee coin info for a chain */
export type FeeCoinInfo = {
  chain: Chain
  ticker: string
  decimals: number
  logo: string
  priceProviderId?: string
}

/** Token discovered at an address (from on-chain scan) */
export type DiscoveredToken = {
  chain: Chain
  contractAddress: string
  ticker: string
  decimals: number
  logo?: string
  balance?: string
  isHidden?: boolean
}

/** Parameters for price lookup */
export type CoinPricesParams = {
  /** CoinGecko price provider IDs */
  ids: string[]
  /** Fiat currency code (default: 'usd') */
  fiatCurrency?: string
}

/** Price lookup result: id -> price in fiat */
export type CoinPricesResult = Record<string, number>

/** One coin's spot price plus optional 24h % change. */
export type CoinPriceWithChange = {
  price: number
  /** 24h % change; absent when CoinGecko has no datum for the id. */
  change24h?: number
}

/** Price+change lookup result: id -> { price, change24h? } */
export type CoinPricesWithChangeResult = Record<string, CoinPriceWithChange>
