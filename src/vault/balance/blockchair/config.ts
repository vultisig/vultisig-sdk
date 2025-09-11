/**
 * Blockchair Configuration
 * Allows users to configure Blockchair as an alternative data source
 */

import { Chain } from '@core/chain/Chain'

import { BlockchairChain } from './types'

/**
 * Data source options for balance and transaction queries
 */
export type DataSource = 'rpc' | 'blockchair' | 'auto'

/**
 * Chain-specific data source configuration
 */
export type ChainDataSourceConfig = {
  [K in Chain]?: DataSource
}

/**
 * Blockchair configuration options
 */
export type BlockchairProviderConfig = {
  /** Whether to use Blockchair as the primary data source */
  enabled: boolean

  /** API key for premium Blockchair features (optional) */
  apiKey?: string

  /** Timeout for Blockchair API calls in milliseconds */
  timeout?: number

  /** Number of retries for failed requests */
  retries?: number

  /** Chain-specific data source preferences */
  chainOverrides?: ChainDataSourceConfig

  /** Fallback behavior when Blockchair fails */
  fallbackToRpc?: boolean
}

/**
 * Default Blockchair configuration
 */
export const DEFAULT_BLOCKCHAIR_CONFIG: BlockchairProviderConfig = {
  enabled: false,
  timeout: 10000,
  retries: 3,
  fallbackToRpc: true,
  chainOverrides: {},
}

/**
 * Map Vultisig chains to Blockchair chain names
 */
export const CHAIN_TO_BLOCKCHAIR_MAPPING: Partial<
  Record<Chain, BlockchairChain>
> = {
  // UTXO chains (already supported)
  [Chain.Bitcoin]: 'bitcoin',
  [Chain.BitcoinCash]: 'bitcoin-cash',
  [Chain.Litecoin]: 'litecoin',
  [Chain.Dogecoin]: 'dogecoin',
  [Chain.Dash]: 'dash',
  [Chain.Zcash]: 'zcash',

  // EVM chains (new Blockchair support)
  [Chain.Ethereum]: 'ethereum',
  [Chain.Base]: 'base',
  [Chain.Arbitrum]: 'arbitrum',
  [Chain.Polygon]: 'polygon',
  [Chain.Optimism]: 'optimism',
  [Chain.BSC]: 'bsc',
  [Chain.Avalanche]: 'avalanche',
  [Chain.Blast]: 'blast',
  [Chain.Zksync]: 'zksync',
  [Chain.CronosChain]: 'cronos',
  [Chain.Mantle]: 'mantle',

  // Other chains
  [Chain.Cardano]: 'cardano',
  [Chain.Solana]: 'solana',
  [Chain.Ripple]: 'ripple',
}

/**
 * Check if a chain is supported by Blockchair
 */
export function isChainSupportedByBlockchair(chain: Chain): boolean {
  return chain in CHAIN_TO_BLOCKCHAIR_MAPPING
}

/**
 * Get Blockchair chain name for a Vultisig chain
 */
export function getBlockchairChainName(chain: Chain): BlockchairChain | null {
  return CHAIN_TO_BLOCKCHAIR_MAPPING[chain] || null
}

/**
 * Determine which data source to use for a given chain and configuration
 */
export function getDataSourceForChain(
  chain: Chain,
  config: BlockchairProviderConfig
): DataSource {
  // Check chain-specific override first
  const override = config.chainOverrides?.[chain]
  if (override) {
    return override
  }

  // If Blockchair is enabled and chain is supported, use Blockchair
  if (config.enabled && isChainSupportedByBlockchair(chain)) {
    return 'blockchair'
  }

  // Default to RPC
  return 'rpc'
}

/**
 * Create a Blockchair configuration with custom overrides
 */
export function createBlockchairConfig(
  overrides: Partial<BlockchairProviderConfig> = {}
): BlockchairProviderConfig {
  return {
    ...DEFAULT_BLOCKCHAIR_CONFIG,
    ...overrides,
  }
}

/**
 * Validate Blockchair configuration
 */
export function validateBlockchairConfig(
  config: BlockchairProviderConfig
): string[] {
  const errors: string[] = []

  if (config.timeout && config.timeout < 1000) {
    errors.push('Timeout must be at least 1000ms')
  }

  if (config.retries && config.retries < 0) {
    errors.push('Retries must be non-negative')
  }

  // Validate chain overrides
  if (config.chainOverrides) {
    for (const [chain, source] of Object.entries(config.chainOverrides)) {
      if (!['rpc', 'blockchair', 'auto'].includes(source)) {
        errors.push(`Invalid data source '${source}' for chain ${chain}`)
      }
    }
  }

  return errors
}
