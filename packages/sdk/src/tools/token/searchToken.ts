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
  let searchResponse: CoinGeckoSearchResponse
  try {
    const result = await queryUrl<CoinGeckoSearchResponse>(
      `${coingeckoApiUrl}/search?query=${encodeURIComponent(query)}`
    )
    if (!result || typeof result === 'string') return []
    searchResponse = result
  } catch {
    return []
  }

  if (!Array.isArray(searchResponse.coins)) {
    return []
  }

  const coins = searchResponse.coins.slice(0, limit)
  if (coins.length === 0) return []

  // Batch-fetch detail for all coins in chunks of 5 to avoid rate-limiting.
  // Each detail call fetches contract addresses across all platforms.
  const chunkSize = 5
  const detailMap = new Map<string, CoinGeckoDetailResponse>()

  for (let i = 0; i < coins.length; i += chunkSize) {
    const chunk = coins.slice(i, i + chunkSize)
    const results = await Promise.allSettled(
      chunk.map(coin =>
        queryUrl<CoinGeckoDetailResponse>(
          `${coingeckoApiUrl}/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`
        )
      )
    )
    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result?.status === 'fulfilled' && result.value && typeof result.value !== 'string') {
        detailMap.set(chunk[j].id, result.value)
      }
    }
  }

  return coins.map(coin => {
    const deployments: TokenDeployment[] = []
    const detail = detailMap.get(coin.id)

    if (detail) {
      for (const [platform, info] of Object.entries(detail.detail_platforms)) {
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
