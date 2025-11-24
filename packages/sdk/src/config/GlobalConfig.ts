import { Chain } from '@core/chain/Chain'

import type { CacheConfig } from '../services/cache-types'

export type GlobalConfigOptions = {
  /**
   * Default blockchain chains to enable for new vaults
   */
  defaultChains?: Chain[]

  /**
   * Default fiat currency for balance displays
   */
  defaultCurrency?: string

  /**
   * Cache configuration for balance/price data
   */
  cacheConfig?: CacheConfig

  /**
   * Password cache settings
   */
  passwordCache?: {
    /**
     * Default TTL in milliseconds (default: 5 minutes)
     */
    defaultTTL?: number
  }

  /**
   * Callback to prompt user for vault password when needed
   * @param vaultId - The vault ID requiring password
   * @param vaultName - The vault name for display
   * @returns Promise resolving to the password
   */
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
}

const DEFAULT_CHAINS: Chain[] = [Chain.Bitcoin, Chain.Ethereum, Chain.Solana, Chain.THORChain, Chain.Ripple]

/**
 * Global configuration singleton.
 * Provides SDK-wide configuration accessible from anywhere.
 *
 * @example
 * ```typescript
 * // Configure at app initialization
 * GlobalConfig.configure({
 *   defaultChains: ['Bitcoin', 'Ethereum'],
 *   defaultCurrency: 'USD',
 *   passwordCache: { defaultTTL: 300000 },
 *   onPasswordRequired: async (vaultId, vaultName) => {
 *     return await promptUserForPassword(vaultName)
 *   }
 * })
 *
 * // Use anywhere
 * const config = GlobalConfig.getInstance()
 * const chains = GlobalConfig.get('defaultChains')
 * ```
 */
export class GlobalConfig {
  private static instance: GlobalConfigOptions | undefined

  /**
   * Configure global SDK settings.
   * Should be called once at application initialization.
   *
   * @param config - Configuration options (uses defaults if not provided)
   */
  static configure(config?: GlobalConfigOptions): void {
    GlobalConfig.instance = {
      defaultChains: config?.defaultChains ?? DEFAULT_CHAINS,
      defaultCurrency: config?.defaultCurrency ?? 'USD',
      cacheConfig: config?.cacheConfig,
      passwordCache: config?.passwordCache,
      onPasswordRequired: config?.onPasswordRequired,
    }
  }

  /**
   * Get the complete global configuration.
   * Falls back to defaults if not explicitly configured.
   *
   * @returns The global configuration object
   */
  static getInstance(): GlobalConfigOptions {
    if (!GlobalConfig.instance) {
      // Lazy initialization with defaults
      GlobalConfig.instance = {
        defaultChains: DEFAULT_CHAINS,
        defaultCurrency: 'USD',
      }
    }
    return GlobalConfig.instance
  }

  /**
   * Get a specific configuration value with type safety.
   *
   * @param key - The configuration key to retrieve
   * @returns The configuration value
   */
  static get<K extends keyof GlobalConfigOptions>(key: K): GlobalConfigOptions[K] {
    return GlobalConfig.getInstance()[key]
  }

  /**
   * Check if configuration has been explicitly set.
   */
  static isConfigured(): boolean {
    return GlobalConfig.instance !== undefined
  }

  /**
   * Reset configuration (useful for testing).
   * @internal
   */
  static reset(): void {
    GlobalConfig.instance = undefined
  }
}
