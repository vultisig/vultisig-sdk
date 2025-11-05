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
 * Check if a chain is supported
 */
export function isChainSupported(chain: string): chain is Chain {
  return chain in Chain
}

/**
 * Convert string to Chain enum with validation
 */
export function stringToChain(chain: string): Chain {
  if (!isChainSupported(chain)) {
    throw new VaultError(
      VaultErrorCode.ChainNotSupported,
      `Unsupported chain: ${chain}`
    )
  }
  return chain as Chain
}

/**
 * Get all supported chains (returns all Chain enum values)
 */
export function getSupportedChains(): string[] {
  return Object.values(Chain)
}

/**
 * Validate chains against supported chains list
 * Returns validated chains or throws VaultError if any chain is unsupported
 */
export function validateChains(chains: string[]): Chain[] {
  const valid: Chain[] = []
  const invalid: string[] = []

  for (const chain of chains) {
    if (chain in Chain) {
      valid.push(chain as Chain)
    } else {
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
