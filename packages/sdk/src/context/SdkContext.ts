/**
 * SDK Context - Instance-scoped dependency container
 *
 * Replaces global singletons with explicit dependency injection.
 * Each Vultisig instance has its own isolated context.
 */

import type { Chain } from '@core/chain/Chain'

import type { ServerManager } from '../server/ServerManager'
import type { CacheConfig } from '../services/cache-types'
import type { PasswordCacheService } from '../services/PasswordCacheService'
import type { Storage } from '../storage/types'

/**
 * WasmProvider - Abstraction for WASM module access
 *
 * Provides access to WalletCore for address derivation and operations.
 * DKLS and Schnorr WASM modules are also initialized when getWalletCore() is called.
 */
export type WasmProvider = {
  /**
   * Get WalletCore instance for address derivation and operations.
   * Lazy loads all WASM modules (WalletCore, DKLS, Schnorr) on first access.
   * Thread-safe: concurrent calls share the same initialization promise.
   */
  getWalletCore(): Promise<any>
}

/**
 * SDK Configuration Options
 *
 * User-facing configuration for creating a Vultisig instance.
 */
export type SdkConfigOptions = {
  /**
   * Default blockchain chains to enable for new vaults
   */
  defaultChains?: Chain[]

  /**
   * Default fiat currency for balance displays (e.g., 'USD', 'EUR')
   */
  defaultCurrency?: string

  /**
   * Cache configuration for balance/price data
   */
  cacheConfig?: CacheConfig

  /**
   * Password cache configuration
   */
  passwordCache?: {
    defaultTTL?: number // milliseconds (0 = disabled)
  }

  /**
   * Callback to prompt user for vault password when needed.
   * Called when a password is required but not cached.
   *
   * @param vaultId - The vault ID requiring password
   * @param vaultName - The vault name for display
   * @returns Promise resolving to the password
   */
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
}

/**
 * SDK Context - Internal dependency container
 *
 * Holds all resolved dependencies for the SDK instance.
 * Immutable after creation to ensure consistency.
 *
 * Each Vultisig instance has its own SdkContext, enabling:
 * - Multiple isolated SDK instances in the same process
 * - Different storage backends per instance
 * - Independent password caches (security isolation)
 * - Different server endpoints per instance
 */
export type SdkContext = {
  /**
   * Storage backend for vault persistence.
   * Each instance has its own storage (or namespaced access).
   */
  readonly storage: Storage

  /**
   * SDK configuration options.
   */
  readonly config: Readonly<SdkConfigOptions>

  /**
   * Server manager for VultiServer communication.
   */
  readonly serverManager: ServerManager

  /**
   * Password cache service for secure password caching.
   * Isolated per instance for security.
   */
  readonly passwordCache: PasswordCacheService

  /**
   * WASM provider for cryptographic operations.
   * References shared WASM runtime (process singleton).
   */
  readonly wasmProvider: WasmProvider
}

/**
 * Vault Context - Subset of SdkContext for vault operations
 *
 * Passed to vault instances and their services.
 */
export type VaultContext = {
  readonly storage: Storage
  readonly config: Readonly<SdkConfigOptions>
  readonly serverManager: ServerManager
  readonly passwordCache: PasswordCacheService
  readonly wasmProvider: WasmProvider
}
