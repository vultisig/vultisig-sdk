import { ChainConfig } from './chains/config/ChainConfig'
import { VaultError, VaultErrorCode } from './vault/VaultError'

/**
 * ChainManager handles SDK-level chain configuration and validation
 * Manages supported chains, default chains, and currency settings
 */
export class ChainManager {
  private defaultChains: string[]
  private defaultCurrency = 'USD'

  constructor(config?: { defaultChains?: string[]; defaultCurrency?: string }) {
    // Use ChainConfig as single source of truth for defaults
    this.defaultChains = config?.defaultChains ?? ChainConfig.getDefaultChains()

    if (config?.defaultCurrency) {
      this.defaultCurrency = config.defaultCurrency
    }
  }

  /**
   * Get all supported chains (immutable)
   * Delegates to ChainConfig for single source of truth
   */
  getSupportedChains(): string[] {
    return ChainConfig.getSupportedChains()
  }

  /**
   * Set SDK-level default chains for new vaults
   * Validates against supported chains list
   */
  setDefaultChains(chains: string[]): void {
    // Use ChainConfig for validation
    const validation = ChainConfig.validateChains(chains)

    if (validation.invalid.length > 0) {
      throw new VaultError(
        VaultErrorCode.ChainNotSupported,
        `Unsupported chains: ${validation.invalid.join(', ')}. Supported chains: ${ChainConfig.getSupportedChains().join(', ')}`
      )
    }

    // Store normalized chain IDs
    this.defaultChains = validation.valid
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
