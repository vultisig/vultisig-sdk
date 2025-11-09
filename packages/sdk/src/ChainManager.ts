import { Chain } from '@core/chain/Chain'

import { VaultError, VaultErrorCode } from './vault/VaultError'

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
 * Check if a chain is supported (case-insensitive)
 */
export function isChainSupported(chain: string): chain is Chain {
  // Check if chain matches any Chain enum value (case-insensitive)
  const chainLower = chain.toLowerCase()
  return Object.values(Chain).some(c => c.toLowerCase() === chainLower)
}

/**
 * Convert string to Chain enum with validation (case-insensitive)
 */
export function stringToChain(chain: string): Chain {
  // Find the Chain enum value that matches (case-insensitive)
  const chainLower = chain.toLowerCase()
  const matchedChain = Object.values(Chain).find(
    c => c.toLowerCase() === chainLower
  )

  if (!matchedChain) {
    throw new VaultError(
      VaultErrorCode.ChainNotSupported,
      `Unsupported chain: ${chain}`
    )
  }

  return matchedChain
}

/**
 * Get all supported chains (returns all Chain enum values)
 */
export function getSupportedChains(): string[] {
  return Object.values(Chain)
}

/**
 * Validate chains against supported chains list (case-insensitive)
 * Returns validated chains or throws VaultError if any chain is unsupported
 */
export function validateChains(chains: string[]): Chain[] {
  const valid: Chain[] = []
  const invalid: string[] = []

  for (const chain of chains) {
    try {
      valid.push(stringToChain(chain))
    } catch {
      invalid.push(chain)
    }
  }

  if (invalid.length > 0) {
    throw new VaultError(
      VaultErrorCode.ChainNotSupported,
      `Unsupported chains: ${invalid.join(', ')}. Supported chains: ${getSupportedChains().join(', ')}`
    )
  }

  return valid
}
