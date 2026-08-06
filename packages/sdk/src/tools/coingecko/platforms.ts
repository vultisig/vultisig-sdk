import { Chain } from '@vultisig/core-chain/Chain'

const chainPlatformEntries = [
  [Chain.Ethereum, 'ethereum'],
  [Chain.BSC, 'binance-smart-chain'],
  [Chain.Polygon, 'polygon-pos'],
  [Chain.Avalanche, 'avalanche-c-chain'],
  [Chain.Arbitrum, 'arbitrum-one'],
  [Chain.Optimism, 'optimistic-ethereum'],
  [Chain.Base, 'base'],
  [Chain.Blast, 'blast'],
  [Chain.Mantle, 'mantle'],
  [Chain.Robinhood, 'robinhood'],
  [Chain.Zksync, 'zksync-era'],
  [Chain.CronosChain, 'cronos'],
  [Chain.Hyperliquid, 'hyperliquid'],
  [Chain.Sei, 'sei'],
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

const chainToCoinGeckoPlatformMap = Object.freeze(
  Object.fromEntries(chainPlatformEntries) as Readonly<Record<Chain, string>>
)

const coinGeckoPlatformToChainMap = Object.freeze(
  Object.fromEntries(chainPlatformEntries.map(([chain, platform]) => [platform, chain])) as Readonly<Record<string, Chain>>
)

export const coinGeckoPlatformForChain = (chain: string): string | undefined =>
  chainToCoinGeckoPlatformMap[chain as Chain]

export const chainForCoinGeckoPlatform = (platform: string): Chain | undefined => coinGeckoPlatformToChainMap[platform]
