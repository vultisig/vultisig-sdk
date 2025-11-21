// ServerManager is internal - import directly from implementation file
import { Chain } from '@core/chain/Chain'

import { AddressBookManager } from './AddressBookManager'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { SdkEvents } from './events/types'
import { PolyfillManager } from './runtime/polyfills'
import { StorageManager } from './runtime/storage/StorageManager'
import type { Storage } from './runtime/storage/types'
import { WasmManager } from './runtime/wasm'
import { ServerManager } from './server/ServerManager'
import {
  AddressBook,
  AddressBookEntry,
  ServerStatus,
  VultisigConfig,
} from './types'
import { Vault } from './vault/Vault'
import { VaultManager } from './VaultManager'

/**
 * Default chains for new vaults
 */
export const DEFAULT_CHAINS: Chain[] = [
  Chain.Bitcoin,
  Chain.Ethereum,
  Chain.Solana,
  Chain.THORChain,
  Chain.Ripple,
]

/**
 * All supported chains (from Chain enum)
 */
export const SUPPORTED_CHAINS: Chain[] = Object.values(Chain)

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 * Now with integrated storage, events, and connection management
 */
export class Vultisig extends UniversalEventEmitter<SdkEvents> {
  private serverManager: ServerManager
  private _initialized = false
  private initializationPromise?: Promise<void>

  // Module managers
  private addressBookManager: AddressBookManager
  private vaultManager: VaultManager

  // Chain and currency configuration
  private _defaultChains: Chain[]
  private _defaultCurrency: string

  // Storage state
  public readonly storage: Storage

  // Public readonly properties (exposed via getters)
  get initialized(): boolean {
    return this._initialized
  }

  get defaultChains(): Chain[] {
    return [...this._defaultChains]
  }

  get defaultCurrency(): string {
    return this._defaultCurrency
  }

  constructor(config?: VultisigConfig) {
    // Initialize EventEmitter
    super()

    // Initialize storage
    this.storage = config?.storage ?? this.createDefaultStorage()

    // Initialize managers
    this.serverManager = new ServerManager(config?.serverEndpoints)

    // Configure WASM if config provided
    if (config?.wasmConfig) {
      WasmManager.configure(config.wasmConfig)
    }

    // Initialize chain and currency configuration
    this._defaultChains = config?.defaultChains ?? DEFAULT_CHAINS
    this._defaultCurrency = config?.defaultCurrency ?? 'USD'

    // Initialize module managers
    this.addressBookManager = new AddressBookManager(this.storage)
    this.vaultManager = new VaultManager(
      this.serverManager,
      {
        defaultChains: config?.defaultChains,
        defaultCurrency: config?.defaultCurrency,
        cacheConfig: config?.cacheConfig,
      },
      this.storage
    )

    // Auto-initialization
    if (config?.autoInit) {
      this.initialize().catch(err => this.emit('error', err))
    }

    // Auto-connection (deprecated, now same as autoInit)
    if (config?.autoConnect) {
      this.initialize().catch(err => this.emit('error', err))
    }
  }

  /**
   * Create default storage based on detected environment.
   * Delegates to StorageManager for environment detection and storage creation.
   * @private
   */
  private createDefaultStorage(): Storage {
    return StorageManager.createDefaultStorage()
  }

  /**
   * Load configuration from storage
   * @private
   */
  private async loadConfigFromStorage(): Promise<void> {
    try {
      // Load default currency
      const storedCurrency = await this.storage.get<string>(
        'config:defaultCurrency'
      )
      if (storedCurrency) {
        this._defaultCurrency = storedCurrency
      }
    } catch {
      // Ignore errors when loading currency (use constructor default)
    }

    try {
      // Load default chains
      const storedChains = await this.storage.get<Chain[]>(
        'config:defaultChains'
      )
      if (storedChains) {
        this._defaultChains = storedChains
      }
    } catch {
      // Ignore errors when loading chains (use constructor default)
    }
  }

  /**
   * Internal auto-initialization helper
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
  }

  /**
   * Initialize the SDK and pre-load all WASM modules (optional but recommended)
   * WASM modules will lazy-load automatically when needed, but calling this
   * upfront can improve performance by avoiding delays during operations
   *
   * Thread-safe: Multiple concurrent calls will share the same initialization promise
   */
  async initialize(): Promise<void> {
    // Already initialized
    if (this.initialized) return

    // Initialization in progress - return existing promise to prevent duplicate initialization
    if (this.initializationPromise) {
      return this.initializationPromise
    }

    // Start new initialization
    this.initializationPromise = (async () => {
      try {
        // Initialize platform-specific items
        await PolyfillManager.initialize()
        await WasmManager.initialize()

        // Load configuration from storage
        await this.loadConfigFromStorage()

        // Initialize managers
        await this.addressBookManager.init()
        await this.vaultManager.init()

        this._initialized = true
      } catch (error) {
        // Reset promise on error so initialization can be retried
        this.initializationPromise = undefined
        throw new Error('Failed to initialize SDK: ' + (error as Error).message)
      }
    })()

    return this.initializationPromise
  }

  // === VAULT LIFECYCLE ===

  /**
   * Create fast vault (2-of-2 with VultiServer)
   * Requires password and email for server coordination and backup delivery
   *
   * @param options.name - Vault name
   * @param options.password - Vault password for encryption
   * @param options.email - Email for verification code delivery
   * @returns Vault instance, vaultId for verification, and verificationRequired flag
   */
  async createFastVault(options: {
    name: string
    password: string
    email: string
  }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: true
  }> {
    await this.ensureInitialized()

    // Create vault with internal progress handling
    const result = await this.vaultManager.createFastVault(options.name, {
      password: options.password,
      email: options.email,
      onProgressInternal: (step, vaultRef) => {
        // Emit progress events with vault reference (undefined early, then populated)
        this.emit('vaultCreationProgress', { vault: vaultRef, step })
      },
    })

    // Emit completion event
    this.emit('vaultCreationComplete', { vault: result.vault })

    // Emit vaultChanged event (VaultManager already saved to storage)
    this.emit('vaultChanged', { vaultId: result.vaultId })

    return result
  }

  /**
   * Create secure vault (multi-device MPC)
   * Not yet implemented - requires multi-device keygen coordination
   *
   * @param options.name - Vault name
   * @param options.keygenMode - Keygen mode configuration
   * @returns Vault instance
   * @throws Error - Not yet implemented
   */
  async createSecureVault(options: {
    name: string
    keygenMode?: 'relay' | 'local'
  }): Promise<Vault> {
    await this.ensureInitialized()

    const vault = await this.vaultManager.createSecureVault(options.name, {
      keygenMode: options.keygenMode,
      onProgressInternal: (step, vaultRef) => {
        this.emit('vaultCreationProgress', { vault: vaultRef, step })
      },
    })

    // Emit completion event
    this.emit('vaultCreationComplete', { vault })

    // Emit vaultChanged event
    this.emit('vaultChanged', { vaultId: vault.publicKeys.ecdsa })

    return vault
  }

  /**
   * Verify fast vault with email code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.serverManager.verifyVault(vaultId, code)
  }

  /**
   * Import vault from .vult file content (sets as active)
   *
   * @param vultContent - The .vult file content as a string
   * @param password - Optional password for encrypted vaults
   * @returns Imported vault instance
   *
   * @example
   * ```typescript
   * const vultContent = fs.readFileSync('vault.vult', 'utf-8')
   * const vault = await sdk.importVault(vultContent, 'password123')
   * ```
   */
  async importVault(vultContent: string, password?: string): Promise<Vault> {
    await this.ensureInitialized()
    const vault = await this.vaultManager.importVault(vultContent, password)

    // VaultManager already handles storage, just emit event
    this.emit('vaultChanged', { vaultId: vault.id.toString() })

    return vault
  }

  /**
   * List all stored vaults as Vault instances
   *
   * @returns Array of Vault class instances
   * @example
   * ```typescript
   * const vaults = await sdk.listVaults()
   * vaults.forEach(vault => {
   *   const summary = vault.summary()
   *   console.log(summary.name)
   * })
   * ```
   */
  async listVaults(): Promise<Vault[]> {
    await this.ensureInitialized()
    return this.vaultManager.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: Vault): Promise<void> {
    await this.ensureInitialized()
    const vaultId = vault.id

    // Delete from VaultManager (which handles all storage)
    await this.vaultManager.deleteVault(vaultId)

    // Emit event with empty vaultId to indicate no active vault
    this.emit('vaultChanged', { vaultId: '' })
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await this.vaultManager.clearVaults()
    await this.storage.clear()
    this.addressBookManager.clear()
    this.emit('vaultChanged', { vaultId: '' })
  }

  // === ACTIVE VAULT MANAGEMENT ===

  /**
   * Switch to different vault or clear active vault
   * @param vault - Vault to set as active, or null to clear active vault
   */
  async setActiveVault(vault: Vault | null): Promise<void> {
    await this.vaultManager.setActiveVault(vault?.id ?? null)
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<Vault | null> {
    return this.vaultManager.getActiveVault()
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    return this.vaultManager.hasActiveVault()
  }

  /**
   * Get vault instance by ID
   *
   * @param vaultId - Numeric vault ID
   * @returns Vault instance or null if not found
   */
  async getVaultById(vaultId: number): Promise<Vault | null> {
    return this.vaultManager.getVaultById(vaultId)
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  async setDefaultCurrency(currency: string): Promise<void> {
    this._defaultCurrency = currency
    await this.storage.set('config:defaultCurrency', currency)
  }

  // === CHAIN OPERATIONS ===

  /**
   * Set SDK-level default chains for new vaults
   */
  async setDefaultChains(chains: Chain[]): Promise<void> {
    this._defaultChains = chains
    await this.storage.set('config:defaultChains', chains)
  }

  // === FILE OPERATIONS ===

  /**
   * Check if .vult file is encrypted
   */
  /**
   * Check if .vult file content is encrypted
   * @param vultContent - The .vult file content as a string
   * @returns true if encrypted, false otherwise
   */
  async isVaultContentEncrypted(vultContent: string): Promise<boolean> {
    return this.vaultManager.isVaultContentEncrypted(vultContent)
  }

  // === SERVER STATUS ===

  /**
   * Check server connectivity
   */
  async getServerStatus(): Promise<ServerStatus> {
    return this.serverManager.checkServerStatus()
  }

  // === ADDRESS BOOK (GLOBAL) ===

  /**
   * Get address book entries
   */
  async getAddressBook(chain?: Chain): Promise<AddressBook> {
    return this.addressBookManager.getAddressBook(chain)
  }

  /**
   * Add address book entries
   */
  async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    return this.addressBookManager.addAddressBookEntry(entries)
  }

  /**
   * Remove address book entries
   */
  async removeAddressBookEntry(
    addresses: Array<{ chain: Chain; address: string }>
  ): Promise<void> {
    return this.addressBookManager.removeAddressBookEntry(addresses)
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: Chain,
    address: string,
    name: string
  ): Promise<void> {
    return this.addressBookManager.updateAddressBookEntry(chain, address, name)
  }

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }
}
