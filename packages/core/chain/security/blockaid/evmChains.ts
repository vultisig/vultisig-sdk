import { EvmChain } from '../../Chain'

export const blockaidEvmChain = {
  [EvmChain.Arbitrum]: 'arbitrum',
  [EvmChain.Avalanche]: 'avalanche',
  [EvmChain.Base]: 'base',
  [EvmChain.Blast]: 'blast',
  [EvmChain.BSC]: 'bsc',
  [EvmChain.Ethereum]: 'ethereum',
  [EvmChain.Hyperliquid]: 'hyperevm',
  [EvmChain.Mantle]: 'mantle',
  [EvmChain.Optimism]: 'optimism',
  [EvmChain.Polygon]: 'polygon',
  [EvmChain.Sei]: 'sei',
  [EvmChain.Zksync]: 'zksync',
  // Robinhood (4663) deliberately absent: Blockaid does not list the chain
  // yet (same posture as CronosChain). Recheck when Blockaid adds support.
} as const

export type BlockaidSupportedEvmChain = keyof typeof blockaidEvmChain

export const blockaidSupportedEvmChains = Object.keys(blockaidEvmChain) as BlockaidSupportedEvmChain[]
