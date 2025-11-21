import { Chain } from '@core/chain/Chain'

import { type CacheService } from '../../services/CacheService'
import { DEFAULT_CHAINS } from '../../Vultisig'

/**
 * PreferencesService
 *
 * Manages user preferences for vault:
 * - Active chain list
 * - Fiat currency preference
 *
 * Handles validation, persistence, and event emission.
 */
export class PreferencesService {
  constructor(
    private cacheService: CacheService,
    private getUserChains: () => Chain[],
    private setUserChains: (chains: Chain[]) => void,
    private getCurrency: () => string,
    private setCurrencyValue: (currency: string) => void,
    private deriveAddresses: (chains: Chain[]) => Promise<void>,
    private saveVault: () => Promise<void>,
    private emitChainAdded: (data: { chain: Chain }) => void,
    private emitChainRemoved: (data: { chain: Chain }) => void
  ) {}

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set user chains (replaces current list)
   *
   * @param chains Array of chains to set
   */
  async setChains(chains: Chain[]): Promise<void> {
    this.setUserChains(chains)

    // Pre-derive addresses for all chains
    await this.deriveAddresses(chains)

    // Save preferences
    await this.saveVault()
  }

  /**
   * Add single chain to user's list
   *
   * @param chain Chain to add
   */
  async addChain(chain: Chain): Promise<void> {
    const currentChains = this.getUserChains()

    if (!currentChains.includes(chain)) {
      this.setUserChains([...currentChains, chain])

      // Pre-derive address for this chain
      await this.deriveAddresses([chain])

      await this.saveVault()

      // Emit chain added event
      this.emitChainAdded({ chain })
    }
  }

  /**
   * Remove single chain from user's list
   * Clears address cache for the chain
   *
   * @param chain Chain to remove
   */
  async removeChain(chain: Chain): Promise<void> {
    const currentChains = this.getUserChains()
    const chainExists = currentChains.includes(chain)

    // Remove from list
    this.setUserChains(currentChains.filter(c => c !== chain))

    // Clear address cache
    const cacheKey = `address:${chain.toLowerCase()}`
    this.cacheService.clear(cacheKey)

    if (chainExists) {
      await this.saveVault()

      // Emit chain removed event
      this.emitChainRemoved({ chain })
    }
  }

  /**
   * Get current user chains
   */
  getChains(): Chain[] {
    return [...this.getUserChains()]
  }

  /**
   * Reset to default chains
   * Uses DEFAULT_CHAINS from ChainManager
   */
  async resetToDefaultChains(): Promise<void> {
    this.setUserChains(DEFAULT_CHAINS)
    await this.deriveAddresses(DEFAULT_CHAINS)
    await this.saveVault()
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set vault fiat currency preference
   *
   * @param currency Currency code (e.g., 'usd', 'eur', 'gbp')
   */
  async setCurrency(currency: string): Promise<void> {
    this.setCurrencyValue(currency)
    await this.saveVault()
  }

  /**
   * Get vault fiat currency preference
   */
  getCurrencyPreference(): string {
    return this.getCurrency()
  }
}
