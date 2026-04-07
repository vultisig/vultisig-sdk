import { Chain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

const coingeckoApiUrl = `${rootApiUrl}/coingeicko/api/v3`

// CoinGecko platform ID -> Vultisig Chain enum mapping
const platformToChain: Record<string, Chain> = {
  ethereum: Chain.Ethereum,
  'binance-smart-chain': Chain.BSC,
  'polygon-pos': Chain.Polygon,
  'avalanche-c-chain': Chain.Avalanche,
  'arbitrum-one': Chain.Arbitrum,
  'optimistic-ethereum': Chain.Optimism,
  base: Chain.Base,
  blast: Chain.Blast,
  mantle: Chain.Mantle,
  'zksync-era': Chain.Zksync,
  cronos: Chain.CronosChain,
  sei: Chain.Sei,
  solana: Chain.Solana,
  tron: Chain.Tron,
  ripple: Chain.Ripple,
  cosmos: Chain.Cosmos,
  osmosis: Chain.Osmosis,
  thorchain: Chain.THORChain,
  sui: Chain.Sui,
  'the-open-network': Chain.Ton,
  cardano: Chain.Cardano,
  polkadot: Chain.Polkadot,
}

type TokenDeployment = {
  chain: Chain
  contractAddress: string
  decimals?: number
}

type TokenSearchResult = {
  id: string
  name: string
  symbol: string
  marketCapRank: number | null
  deployments: TokenDeployment[]
}

type CoinGeckoSearchResponse = {
  coins: {
    id: string
    name: string
    symbol: string
    market_cap_rank: number | null
  }[]
}

type CoinGeckoDetailResponse = {
  id: string
  detail_platforms: Record<string, { contract_address: string; decimal_place: number | null }>
}

/**
 * Search tokens by ticker, name, or contract address across all supported chains.
 * Queries CoinGecko via the Vultisig proxy.
 *
 * @example
 * ```ts
 * const results = await searchToken('USDC')
 * // => [{ id: 'usd-coin', name: 'USD Coin', symbol: 'usdc', deployments: [...] }]
 * ```
 */
export const searchToken = async (query: string, limit = 10): Promise<TokenSearchResult[]> => {
  const searchResponse = await queryUrl<CoinGeckoSearchResponse>(
    `${coingeckoApiUrl}/search?query=${encodeURIComponent(query)}`
  )

  if (!searchResponse || typeof searchResponse === 'string') {
    return []
  }

  const coins = searchResponse.coins.slice(0, limit)
  if (coins.length === 0) return []

  // Fetch detail for each coin concurrently to get contract addresses
  const details = await Promise.allSettled(
    coins.map(coin =>
      queryUrl<CoinGeckoDetailResponse>(
        `${coingeckoApiUrl}/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`
      )
    )
  )

  return coins.map((coin, i) => {
    const detail = details[i]
    const deployments: TokenDeployment[] = []

    if (detail?.status === 'fulfilled' && detail.value && typeof detail.value !== 'string') {
      const platforms = detail.value.detail_platforms
      for (const [platform, info] of Object.entries(platforms)) {
        if (!info.contract_address) continue
        const chain = platformToChain[platform]
        if (!chain) continue
        deployments.push({
          chain,
          contractAddress: info.contract_address,
          decimals: info.decimal_place ?? undefined,
        })
      }
    }

    return {
      id: coin.id,
      name: coin.name,
      symbol: coin.symbol,
      marketCapRank: coin.market_cap_rank,
      deployments,
    }
  })
}
