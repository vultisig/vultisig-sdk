/**
 * INTERNAL ONLY - Chain utility functions
 *
 * These are thin wrappers around core chain functionality for internal SDK use.
 * DO NOT export from public API (packages/sdk/src/index.ts)
 *
 * Replaces the hardcoded ChainConfig registry with direct core function usage
 */

import { Chain, EvmChain, UtxoChain, CosmosChain } from '@core/chain/Chain'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getChainKind, ChainKind } from '@core/chain/ChainKind'

/**
 * Default chains for new vaults
 * Used when user doesn't specify custom chain list
 */
export const DEFAULT_CHAINS: Chain[] = [
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana,
  Chain.THORChain,
  Chain.Ripple,
]

/**
 * Get decimal places for a chain's native token
 * @example getChainDecimals(Chain.Bitcoin) // Returns: 8
 */
export function getChainDecimals(chain: Chain): number {
  return chainFeeCoin[chain].decimals
}

/**
 * Get ticker symbol for a chain's native token
 * @example getChainSymbol(Chain.Ethereum) // Returns: 'ETH'
 */
export function getChainSymbol(chain: Chain): string {
  return chainFeeCoin[chain].ticker
}

/**
 * Get all supported chains
 * @returns Array of all Chain enum values
 */
export function getSupportedChains(): Chain[] {
  return Object.values(Chain)
}

/**
 * Check if a chain is supported
 * @param chain - Chain identifier (string or Chain enum)
 */
export function isChainSupported(chain: string): chain is Chain {
  return chain in Chain
}

/**
 * Validate multiple chains
 * @returns Object with valid and invalid chain arrays
 */
export function validateChains(chains: string[]): {
  valid: Chain[]
  invalid: string[]
} {
  const valid: Chain[] = []
  const invalid: string[] = []

  for (const chain of chains) {
    if (isChainSupported(chain)) {
      valid.push(chain as Chain)
    } else {
      invalid.push(chain)
    }
  }

  return { valid, invalid }
}

/**
 * Get chain kind (evm, utxo, cosmos, other)
 * Uses core's getChainKind function
 */
export function getChainType(chain: Chain): ChainKind {
  return getChainKind(chain)
}

/**
 * Check if chain is EVM-based
 */
export function isEvmChain(chain: Chain): boolean {
  return Object.values(EvmChain).includes(chain as any)
}

/**
 * Check if chain is UTXO-based
 */
export function isUtxoChain(chain: Chain): boolean {
  return Object.values(UtxoChain).includes(chain as any)
}

/**
 * Check if chain is Cosmos-based
 */
export function isCosmosChain(chain: Chain): boolean {
  return Object.values(CosmosChain).includes(chain as any)
}

/**
 * Get all EVM chains
 */
export function getEvmChains(): Chain[] {
  return Object.values(EvmChain)
}

/**
 * Get all UTXO chains
 */
export function getUtxoChains(): Chain[] {
  return Object.values(UtxoChain)
}

/**
 * Get all Cosmos chains
 */
export function getCosmosChains(): Chain[] {
  return Object.values(CosmosChain)
}

/**
 * Convert string to Chain enum with validation
 * Useful for backward compatibility
 */
export function stringToChain(chain: string): Chain {
  if (!isChainSupported(chain)) {
    throw new Error(`Unsupported chain: ${chain}`)
  }
  return chain as Chain
}
