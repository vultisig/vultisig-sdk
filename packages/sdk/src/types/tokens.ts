import type { Chain } from '@core/chain/Chain'

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
