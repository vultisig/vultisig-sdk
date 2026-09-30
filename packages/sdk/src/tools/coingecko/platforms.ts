import { Chain } from '@vultisig/core-chain/Chain'

// Canonical IDs from the CoinGecko asset_platforms endpoint used by the proxy.
// Both deployment discovery and contract pricing derive their lookups here.
export const coinGeckoPlatforms = [
  [Chain.Ethereum, 'ethereum'],
  [Chain.BSC, 'binance-smart-chain'],
  [Chain.Polygon, 'polygon-pos'],
  [Chain.Avalanche, 'avalanche'],
  [Chain.Arbitrum, 'arbitrum-one'],
  [Chain.Optimism, 'optimistic-ethereum'],
  [Chain.Base, 'base'],
  [Chain.Blast, 'blast'],
  [Chain.Mantle, 'mantle'],
  [Chain.Robinhood, 'robinhood'],
  [Chain.Zksync, 'zksync'],
  [Chain.CronosChain, 'cronos'],
  [Chain.Hyperliquid, 'hyperliquid'],
  [Chain.Sei, 'sei-v2'],
  [Chain.Solana, 'solana'],
  [Chain.Tron, 'tron'],
  [Chain.Ripple, 'ripple'],
  [Chain.Cosmos, 'cosmos'],
  [Chain.Osmosis, 'osmosis'],
  [Chain.THORChain, 'thorchain'],
  [Chain.Sui, 'sui'],
  [Chain.Ton, 'the-open-network'],
  [Chain.Cardano, 'cardano'],
  [Chain.Polkadot, 'polkadot'],
] as const satisfies ReadonlyArray<readonly [Chain, string]>

const chainToPlatform = new Map<string, string>(coinGeckoPlatforms)
const platformToChain = new Map<string, Chain>(coinGeckoPlatforms.map(([chain, platform]) => [platform, chain]))

export const coinGeckoPlatformForChain = (chain: string): string | undefined => chainToPlatform.get(chain)

export const chainForCoinGeckoPlatform = (platform: string): Chain | undefined => platformToChain.get(platform)
