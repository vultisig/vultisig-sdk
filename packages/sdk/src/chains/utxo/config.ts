import { Chain } from '@core/chain/Chain'
import { UtxoChainConfig } from './types'

/**
 * Configuration for all supported UTXO chains
 *
 * Script Types:
 * - wpkh (Witness Pay-to-Public-Key-Hash): Bitcoin, Litecoin
 * - pkh (Pay-to-Public-Key-Hash): Bitcoin Cash, Dogecoin, Dash, Zcash
 *
 * Dust Limits (minimum UTXO value):
 * - Standard: 546 satoshis
 * - Varying by chain based on network rules
 */
export const UTXO_CHAIN_CONFIGS: Record<string, UtxoChainConfig> = {
  [Chain.Bitcoin]: {
    chain: Chain.Bitcoin,
    scriptType: 'wpkh', // SegWit
    decimals: 8,
    symbol: 'BTC',
    dustLimit: 546, // satoshis
    blockchairName: 'bitcoin',
  },

  [Chain.Litecoin]: {
    chain: Chain.Litecoin,
    scriptType: 'wpkh', // SegWit
    decimals: 8,
    symbol: 'LTC',
    dustLimit: 546, // litoshis
    blockchairName: 'litecoin',
  },

  [Chain.BitcoinCash]: {
    chain: Chain.BitcoinCash,
    scriptType: 'pkh', // Legacy
    decimals: 8,
    symbol: 'BCH',
    dustLimit: 546, // satoshis
    blockchairName: 'bitcoin-cash',
  },

  [Chain.Dogecoin]: {
    chain: Chain.Dogecoin,
    scriptType: 'pkh', // Legacy
    decimals: 8,
    symbol: 'DOGE',
    dustLimit: 100000000, // 1 DOGE in dogetoshis
    blockchairName: 'dogecoin',
  },

  [Chain.Dash]: {
    chain: Chain.Dash,
    scriptType: 'pkh', // Legacy
    decimals: 8,
    symbol: 'DASH',
    dustLimit: 546, // duffs
    blockchairName: 'dash',
  },

  [Chain.Zcash]: {
    chain: Chain.Zcash,
    scriptType: 'pkh', // Legacy
    decimals: 8,
    symbol: 'ZEC',
    dustLimit: 546, // zatoshis
    blockchairName: 'zcash',
    specialParams: {
      // Zcash requires special branch ID for transaction signing
      branchId: '0x5510e7c8',
    },
  },
}

/**
 * Get configuration for a UTXO chain
 * @param chainId Chain identifier
 * @returns Chain configuration
 * @throws Error if chain is not a supported UTXO chain
 */
export function getUtxoChainConfig(chainId: string): UtxoChainConfig {
  const config = UTXO_CHAIN_CONFIGS[chainId]
  if (!config) {
    throw new Error(
      `Chain ${chainId} is not a supported UTXO chain. ` +
      `Supported chains: ${Object.keys(UTXO_CHAIN_CONFIGS).join(', ')}`
    )
  }
  return config
}

/**
 * Check if a chain is a supported UTXO chain
 * @param chainId Chain identifier
 * @returns True if chain is a supported UTXO chain
 */
export function isUtxoChain(chainId: string): boolean {
  return chainId in UTXO_CHAIN_CONFIGS
}

/**
 * Get all supported UTXO chain IDs
 * @returns Array of UTXO chain identifiers
 */
export function getSupportedUtxoChains(): string[] {
  return Object.keys(UTXO_CHAIN_CONFIGS)
}
