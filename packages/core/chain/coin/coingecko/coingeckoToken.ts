export type SolanaCoingeckoTokenResponse = {
  data: {
    id: string
    type: 'token'
    attributes: {
      coingecko_coin_id: string
    }
  }
}

/** CoinGecko's on-chain multi-token lookup; a mint it does not index is simply missing from `data`. */
export type SolanaCoingeckoTokensResponse = {
  data?: {
    id: string
    type: 'token'
    attributes?: {
      address?: string
      coingecko_coin_id?: string | null
    }
  }[]
}

export type SolanaFmTokenResponse = {
  tokenList?: {
    extensions?: {
      coingeckoId?: string
    } | null
  } | null
}
