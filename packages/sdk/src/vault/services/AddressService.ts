import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { ChainStrategyFactory } from '../../chains/strategies/ChainStrategyFactory'

/**
 * Service for coordinating address derivation across chains.
 * Uses strategy pattern to delegate to chain-specific implementations.
 */
export class AddressService {
  constructor(private strategyFactory: ChainStrategyFactory) {}

  /**
   * Derive address for a vault on a specific chain
   * @param vault Vault data
   * @param chain Chain identifier (e.g., 'Ethereum', 'Solana')
   */
  async deriveAddress(vault: CoreVault, chain: string): Promise<string> {
    const strategy = this.strategyFactory.getStrategy(chain)
    return strategy.deriveAddress(vault)
  }

  /**
   * Derive addresses for a vault across multiple chains
   * @param vault Vault data
   * @param chains List of chain identifiers
   */
  async deriveMultipleAddresses(
    vault: CoreVault,
    chains: string[]
  ): Promise<Record<string, string>> {
    const addresses: Record<string, string> = {}

    // Derive in parallel for better performance
    await Promise.all(
      chains.map(async (chain) => {
        try {
          addresses[chain] = await this.deriveAddress(vault, chain)
        } catch (error) {
          console.error(`Failed to derive address for ${chain}:`, error)
          // Continue with other chains even if one fails
        }
      })
    )

    return addresses
  }

  /**
   * Check if a chain is supported
   * @param chain Chain identifier
   */
  isSupported(chain: string): boolean {
    return this.strategyFactory.isSupported(chain)
  }

  /**
   * Get all supported chains
   */
  getSupportedChains(): string[] {
    return this.strategyFactory.getSupportedChains()
  }
}
