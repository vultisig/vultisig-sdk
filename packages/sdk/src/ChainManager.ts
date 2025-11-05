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
 * ChainManager handles SDK-level chain configuration and validation
 * Manages supported chains, default chains, and currency settings
 */
export class ChainManager {
  private defaultChains: string[]
  private defaultCurrency = 'USD'

  constructor(config?: { defaultChains?: string[]; defaultCurrency?: string }) {
    // Use DEFAULT_CHAINS as single source of truth for defaults
    this.defaultChains = config?.defaultChains ?? DEFAULT_CHAINS

    if (config?.defaultCurrency) {
      this.defaultCurrency = config.defaultCurrency
    }
  }

  /**
   * Get all supported chains (immutable)
   */
  getSupportedChains(): string[] {
    return Object.values(Chain)
  }

  /**
   * Set SDK-level default chains for new vaults
   * Validates against supported chains list
   */
  setDefaultChains(chains: string[]): void {
    // Validate chains
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
        `Unsupported chains: ${invalid.join(', ')}. Supported chains: ${this.getSupportedChains().join(', ')}`
      )
    }

    // Store normalized chain IDs
    this.defaultChains = valid
    // TODO: Save config to storage
  }

  /**
   * Get SDK-level default chains (5 top chains: BTC, ETH, SOL, THOR, XRP)
   */
  getDefaultChains(): string[] {
    return this.defaultChains
  }

  /**
   * Set global default currency
   */
  setDefaultCurrency(currency: string): void {
    this.defaultCurrency = currency
    // TODO: Save config to storage
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.defaultCurrency
  }
}
