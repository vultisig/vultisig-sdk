import { Chain } from "@core/chain/Chain";

import { DEFAULT_CHAINS } from "../../constants";
import { type CacheService } from "../../services/CacheService";

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
    private emitChainRemoved: (data: { chain: Chain }) => void,
  ) {}

  // ===== CHAIN MANAGEMENT =====

  /**
   * Set user chains (replaces current list)
   *
   * @param chains Array of chains to set
   */
  async setChains(chains: Chain[]): Promise<void> {
    // Pre-derive addresses for all chains BEFORE mutating state
    // This ensures validation happens first - if any derivation fails,
    // the vault state remains unchanged
    await this.deriveAddresses(chains);

    // Only mutate state after validation succeeds
    this.setUserChains(chains);

    // Save preferences
    await this.saveVault();
  }

  /**
   * Add single chain to user's list
   *
   * @param chain Chain to add
   */
  async addChain(chain: Chain): Promise<void> {
    const currentChains = this.getUserChains();

    if (!currentChains.includes(chain)) {
      // Pre-derive address for this chain BEFORE mutating state
      // This ensures validation happens first - if derivation fails,
      // the vault state remains unchanged
      await this.deriveAddresses([chain]);

      // Only mutate state after validation succeeds
      this.setUserChains([...currentChains, chain]);

      await this.saveVault();

      // Emit chain added event
      this.emitChainAdded({ chain });
    }
  }

  /**
   * Remove single chain from user's list
   * Clears address cache for the chain
   *
   * @param chain Chain to remove
   */
  async removeChain(chain: Chain): Promise<void> {
    const currentChains = this.getUserChains();
    const chainExists = currentChains.includes(chain);

    if (chainExists) {
      const cacheKey = `address:${chain.toLowerCase()}`;

      // Optimistically remove from list and clear cache
      this.setUserChains(currentChains.filter((c) => c !== chain));
      this.cacheService.clear(cacheKey);

      try {
        // Attempt to persist changes
        await this.saveVault();

        // Emit chain removed event only after successful save
        this.emitChainRemoved({ chain });
      } catch (error) {
        // Rollback on failure to maintain consistency
        this.setUserChains(currentChains);
        // Note: Cache clear is not rolled back as it's a performance optimization
        // and clearing a non-existent entry is harmless
        throw error;
      }
    }
  }

  /**
   * Get current user chains
   */
  getChains(): Chain[] {
    return [...this.getUserChains()];
  }

  /**
   * Reset to default chains
   * Uses DEFAULT_CHAINS from ChainManager
   */
  async resetToDefaultChains(): Promise<void> {
    this.setUserChains(DEFAULT_CHAINS);
    await this.deriveAddresses(DEFAULT_CHAINS);
    await this.saveVault();
  }

  // ===== CURRENCY MANAGEMENT =====

  /**
   * Set vault fiat currency preference
   *
   * @param currency Currency code (e.g., 'usd', 'eur', 'gbp')
   */
  async setCurrency(currency: string): Promise<void> {
    this.setCurrencyValue(currency);
    await this.saveVault();
  }

  /**
   * Get vault fiat currency preference
   */
  getCurrencyPreference(): string {
    return this.getCurrency();
  }
}
