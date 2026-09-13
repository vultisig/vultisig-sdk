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
  [EvmChain.Robinhood]: 'robinhood',
  [EvmChain.Sei]: 'sei',
  [EvmChain.Zksync]: 'zksync',
  // CronosChain deliberately absent: Blockaid rejects `cronos` as not
  // supported in GA. Recheck against the live endpoint before adding it.
} as const

export type BlockaidSupportedEvmChain = keyof typeof blockaidEvmChain

export const blockaidSupportedEvmChains = Object.keys(blockaidEvmChain) as BlockaidSupportedEvmChain[]
