import { Chain } from '@vultisig/sdk'

/**
 * Commonly used chains for quick access
 */
export const POPULAR_CHAINS: Chain[] = [
  Chain.Ethereum,
  Chain.Bitcoin,
  Chain.Avalanche,
  Chain.BSC,
  Chain.Polygon,
  Chain.Arbitrum,
  Chain.Optimism,
  Chain.Base,
]

/**
 * All supported chains
 */
export const ALL_CHAINS: Chain[] = [
  Chain.Ethereum,
  Chain.Bitcoin,
  Chain.Avalanche,
  Chain.BSC,
  Chain.Polygon,
  Chain.Arbitrum,
  Chain.Optimism,
  Chain.Base,
  Chain.Solana,
  Chain.THORChain,
  Chain.MayaChain,
  Chain.Cosmos,
  Chain.Kujira,
  Chain.Dydx,
  Chain.Polkadot,
  Chain.Sui,
  // Add more as SDK supports them
]

/**
 * Get chain display name
 */
export function getChainDisplayName(chain: Chain): string {
  return chain
}

/**
 * Get chain color for UI
 */
export function getChainColor(chain: Chain): string {
  const colors: Record<string, string> = {
    Ethereum: '#627EEA',
    Bitcoin: '#F7931A',
    Avalanche: '#E84142',
    BSC: '#F3BA2F',
    Polygon: '#8247E5',
    Arbitrum: '#28A0F0',
    Optimism: '#FF0420',
    Base: '#0052FF',
    Solana: '#14F195',
    THORChain: '#00CCFF',
  }
  return colors[chain] || '#6B7280'
}
