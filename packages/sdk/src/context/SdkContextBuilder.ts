/**
 * SdkContextBuilder - Factory for creating SdkContext instances
 *
 * Provides a fluent builder API for constructing SDK contexts with
 * proper validation and default values.
 */

import { Chain } from '@core/chain/Chain'

import { DEFAULT_CHAINS } from '../constants'
import { ServerManager } from '../server/ServerManager'
import { PasswordCacheService } from '../services/PasswordCacheService'
import type { Storage } from '../storage/types'
import type { SdkConfigOptions, SdkContext } from './SdkContext'

// Re-export SdkContext type for consumers
export type { SdkContext } from './SdkContext'
import { getWalletCore } from './wasmRuntime'

/**
 * Default fiat currency
 */
const DEFAULT_CURRENCY = 'USD'

/**
 * Server endpoint configuration
 */
export type ServerEndpoints = {
  fastVault?: string
  messageRelay?: string
}

/**
 * Password cache configuration
 */
export type PasswordCacheConfig = {
  /**
   * Time to live for cached passwords in milliseconds.
   * Default: 5 minutes (300000ms)
   */
  defaultTTL?: number
}

/**
 * Builder options for creating an SdkContext
 */
export type SdkContextBuilderOptions = {
  storage: Storage
  serverEndpoints?: ServerEndpoints
  defaultChains?: Chain[]
  defaultCurrency?: string
  cacheConfig?: SdkConfigOptions['cacheConfig']
  passwordCacheConfig?: PasswordCacheConfig
  onPasswordRequired?: SdkConfigOptions['onPasswordRequired']
}

/**
 * SdkContextBuilder - Fluent builder for SdkContext
 *
 * @example
 * ```typescript
 * const context = new SdkContextBuilder()
 *   .withStorage(new FileStorage({ basePath: '~/.myapp' }))
 *   .withServerEndpoints({ fastVault: 'https://custom.api.com' })
 *   .withConfig({ defaultChains: [Chain.Bitcoin] })
 *   .build()
 * ```
 */
export class SdkContextBuilder {
  private storage?: Storage
  private serverEndpoints?: ServerEndpoints
  private defaultChains?: Chain[]
  private defaultCurrency?: string
  private cacheConfig?: SdkConfigOptions['cacheConfig']
  private passwordCacheConfig?: PasswordCacheConfig
  private onPasswordRequired?: SdkConfigOptions['onPasswordRequired']

  /**
   * Set the storage backend (required)
   */
  withStorage(storage: Storage): this {
    this.storage = storage
    return this
  }

  /**
   * Set custom server endpoints
   */
  withServerEndpoints(endpoints: ServerEndpoints): this {
    this.serverEndpoints = endpoints
    return this
  }

  /**
   * Set configuration options
   */
  withConfig(config: {
    defaultChains?: Chain[]
    defaultCurrency?: string
    cacheConfig?: SdkConfigOptions['cacheConfig']
    passwordCache?: SdkConfigOptions['passwordCache']
    onPasswordRequired?: SdkConfigOptions['onPasswordRequired']
  }): this {
    if (config.defaultChains !== undefined) {
      this.defaultChains = config.defaultChains
    }
    if (config.defaultCurrency !== undefined) {
      this.defaultCurrency = config.defaultCurrency
    }
    if (config.cacheConfig !== undefined) {
      this.cacheConfig = config.cacheConfig
    }
    if (config.passwordCache !== undefined) {
      this.passwordCacheConfig = config.passwordCache
    }
    if (config.onPasswordRequired !== undefined) {
      this.onPasswordRequired = config.onPasswordRequired
    }
    return this
  }

  /**
   * Set password cache configuration
   */
  withPasswordCache(config: PasswordCacheConfig): this {
    this.passwordCacheConfig = config
    return this
  }

  /**
   * Build the SdkContext
   *
   * @throws Error if storage is not configured
   */
  build(): SdkContext {
    if (!this.storage) {
      throw new Error(
        'Storage is required. Call withStorage() before build(). ' +
          'Example: new SdkContextBuilder().withStorage(new FileStorage()).build()'
      )
    }

    // Create ServerManager with optional custom endpoints
    const serverManager = new ServerManager(this.serverEndpoints)

    // Create PasswordCacheService (instance-scoped, not singleton)
    const passwordCache = new PasswordCacheService(this.passwordCacheConfig)

    // Create WasmProvider (simple object wrapping the module-level getWalletCore)
    const wasmProvider = { getWalletCore }

    // Build immutable config
    const config: Readonly<SdkConfigOptions> = Object.freeze({
      defaultChains: this.defaultChains ?? DEFAULT_CHAINS,
      defaultCurrency: this.defaultCurrency ?? DEFAULT_CURRENCY,
      cacheConfig: this.cacheConfig,
      passwordCache: this.passwordCacheConfig,
      onPasswordRequired: this.onPasswordRequired,
    })

    return {
      storage: this.storage,
      config,
      serverManager,
      passwordCache,
      wasmProvider,
    }
  }
}

/**
 * Create an SdkContext from options object
 *
 * Convenience function for simple context creation.
 *
 * @example
 * ```typescript
 * const context = createSdkContext({
 *   storage: new MemoryStorage(),
 *   defaultChains: [Chain.Bitcoin],
 * })
 * ```
 */
export function createSdkContext(options: SdkContextBuilderOptions): SdkContext {
  const builder = new SdkContextBuilder().withStorage(options.storage)

  if (options.serverEndpoints) {
    builder.withServerEndpoints(options.serverEndpoints)
  }

  builder.withConfig({
    defaultChains: options.defaultChains,
    defaultCurrency: options.defaultCurrency,
    cacheConfig: options.cacheConfig,
    onPasswordRequired: options.onPasswordRequired,
  })

  if (options.passwordCacheConfig) {
    builder.withPasswordCache(options.passwordCacheConfig)
  }

  return builder.build()
}
