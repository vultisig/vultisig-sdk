import { FastSigningService } from '../services/FastSigningService'

/**
 * Services required by Vault for operations
 * Simplified - only essential services needed
 * Vault calls core functions directly - no service layers
 *
 * Note: CacheService and FiatValueService are created internally by Vault
 * Note: WasmManager is now static and accessed directly
 */
export type VaultServices = {
  fastSigningService?: FastSigningService
}

import type { Chain } from '@core/chain/Chain'

import type { CacheConfig } from '../services/cache-types'

/**
 * Configuration for Vault initialization
 * Contains user-level preferences, not static chain data
 */
export type VaultConfig = {
  /** Default chains for new vaults (from SDK config) */
  defaultChains?: Chain[]
  /** Default currency for balance display (from SDK config) */
  defaultCurrency?: string
  /** Cache configuration (TTLs, size limits) */
  cacheConfig?: CacheConfig
  /** Password cache configuration */
  passwordCache?: {
    defaultTTL?: number
  }
  /** Password prompt callback */
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
}
