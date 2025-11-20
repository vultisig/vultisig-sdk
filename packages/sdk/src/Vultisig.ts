// ServerManager is internal - import directly from implementation file
import { Chain } from '@core/chain/Chain'

import { AddressBookManager } from './AddressBookManager'
import {
  DEFAULT_CHAINS,
  getSupportedChains,
  validateChains,
} from './ChainManager'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { SdkEvents } from './events/types'
import { isNode } from './runtime/environment'
import { StorageManager } from './runtime/storage/StorageManager'
import type { VaultStorage } from './runtime/storage/types'
import { ServerManager } from './server/ServerManager'
import {
  AddressBook,
  AddressBookEntry,
  ServerStatus,
  Signature,
  SigningPayload,
  ValidationResult,
  VultisigConfig,
} from './types'
import { ValidationHelpers } from './utils/validation'
import { Vault } from './vault/Vault'
import { VaultManager } from './VaultManager'
import { WASMManager } from './wasm'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 * Now with integrated storage, events, and connection management
 */
export class Vultisig extends UniversalEventEmitter<SdkEvents> {
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false
  private initializationPromise?: Promise<void>

  // Module managers
  private addressBookManager: AddressBookManager
  private vaultManager: VaultManager

  // Chain and currency configuration
  private defaultChains: Chain[]
  private defaultCurrency: string

  // Storage and connection state
  private storage: VaultStorage
  private connected = false
  private activeChain: Chain

  constructor(config?: VultisigConfig) {
    // Initialize EventEmitter
    super()

    // Initialize storage and connection state
    this.storage = config?.storage ?? this.createDefaultStorage()
    this.connected = false
    this.activeChain = Chain.Ethereum

    // Initialize managers
    this.serverManager = new ServerManager(config?.serverEndpoints)
    this.wasmManager = new WASMManager(config?.wasmConfig)

    // Initialize chain and currency configuration
    this.defaultChains = config?.defaultChains ?? DEFAULT_CHAINS
    this.defaultCurrency = config?.defaultCurrency ?? 'USD'

    // Validate chains if provided
    if (config?.defaultChains) {
      validateChains(config.defaultChains) // Throws if invalid
    }

    // Initialize module managers
    this.addressBookManager = new AddressBookManager(this.storage)
    this.vaultManager = new VaultManager(
      this.wasmManager,
      this.serverManager,
      {
        defaultChains: config?.defaultChains,
        defaultCurrency: config?.defaultCurrency,
      },
      this.storage
    )

    // Auto-initialization
    if (config?.autoInit) {
      this.initialize().catch(err => this.emit('error', err))
    }

    // Auto-connection
    if (config?.autoConnect) {
      this.connect().catch(err => this.emit('error', err))
    }
  }

  /**
   * Create default storage based on detected environment.
   * Delegates to StorageManager for environment detection and storage creation.
   * @private
   */
  private createDefaultStorage(): VaultStorage {
    return StorageManager.createDefaultStorage()
  }

  /**
   * Load configuration from storage
   * @private
   */
  private async loadConfigFromStorage(): Promise<void> {
    // Load default currency
    const storedCurrency = await this.storage.get<string>(
      'config:defaultCurrency'
    )
    if (storedCurrency) {
      this.defaultCurrency = storedCurrency
    }

    // Load default chains
    const storedChains = await this.storage.get<Chain[]>('config:defaultChains')
    if (storedChains) {
      this.defaultChains = storedChains
    }

    // Load active chain
    const storedActiveChain = await this.storage.get<Chain>('activeChain')
    if (storedActiveChain) {
      this.activeChain = storedActiveChain
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
        // Initialize Node.js polyfills first (if in Node.js)
        if (isNode()) {
          const { initializeNodePolyfills } = await import(
            './runtime/utils/node'
          )
          await initializeNodePolyfills()
        }

        await this.wasmManager.initialize()

        // Load configuration from storage
        await this.loadConfigFromStorage()

        // Initialize managers
        await this.addressBookManager.init()
        await this.vaultManager.init()

        this.initialized = true
      } catch (error) {
        // Reset promise on error so initialization can be retried
        this.initializationPromise = undefined
        throw new Error('Failed to initialize SDK: ' + (error as Error).message)
      }
    })()

    return this.initializationPromise
  }

  /**
   * Check if SDK is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  // === CONNECTION MANAGEMENT ===

  /**
   * Connect to storage and optionally load a vault
   * Initializes WASM modules and loads the last active vault or a specific vault from storage
   */
  async connect(options?: { vaultId?: number }): Promise<void> {
    try {
      // Initialize WASM modules
      await this.initialize()

      if (options?.vaultId !== undefined) {
        // Load specific vault
        await this.loadVaultFromStorage(options.vaultId)
      } else {
        // Auto-load last active vault
        await this.loadLastActiveVault()
      }

      this.connected = true
      this.emit('connect', {})
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  /**
   * Disconnect and clear active vault
   */
  async disconnect(): Promise<void> {
    await this.vaultManager.setActiveVault(null)
    this.connected = false
    this.emit('disconnect', {})
  }

  /**
   * Check if connected with active vault
   */
  async isConnected(): Promise<boolean> {
    return this.connected && (await this.hasActiveVault())
  }

  /**
   * Load vault from storage by ID
   * @private
   */
  private async loadVaultFromStorage(vaultId: number): Promise<void> {
    const vault = await this.vaultManager.getVaultById(vaultId)
    if (!vault) {
      throw new Error(`Vault not found: ${vaultId}`)
    }

    // Vault is already loaded and set as active by VaultManager
    // Just emit event
    this.emit('vaultChanged', { vaultId: vaultId.toString() })
  }

  /**
   * Load last active vault from storage
   * @private
   */
  private async loadLastActiveVault(): Promise<void> {
    const lastVaultId = await this.storage.get<number>('activeVaultId')
    if (lastVaultId !== null && lastVaultId !== undefined) {
      try {
        await this.loadVaultFromStorage(lastVaultId)
      } catch (error) {
        console.warn('Failed to load last active vault:', error)
        // Don't throw - continue with no active vault
      }
    }
  }

  /**
   * Save vault to storage
   * @private
   */
  // Note: Storage is now handled by VaultManager, so this method is no longer needed
  // Keeping for backward compatibility but it's a no-op
  private async saveVaultToStorage(_vault: Vault): Promise<void> {
    // VaultManager already handles all storage operations
    // This method is kept for compatibility but does nothing
  }

  // === VAULT LIFECYCLE ===

  /**
   * Create new vault (auto-initializes SDK, sets as active)
   */
  async createVault(
    name: string,
    options?: {
      type?: 'fast' | 'secure'
      keygenMode?: 'relay' | 'local'
      password?: string
      email?: string
    }
  ): Promise<Vault> {
    await this.ensureInitialized()

    // Create vault with internal progress handling
    const vault = await this.vaultManager.createVault(name, {
      ...options,
      onProgressInternal: (step, vaultRef) => {
        // Emit progress events with vault reference (undefined early, then populated)
        this.emit('vaultCreationProgress', { vault: vaultRef, step })
      },
    })

    // Emit completion event
    this.emit('vaultCreationComplete', { vault })

    // Save to storage and emit vaultChanged event
    await this.saveVaultToStorage(vault)
    this.emit('vaultChanged', { vaultId: vault.summary().id })

    return vault
  }

  /**
   * Create fast vault (convenience method)
   * Equivalent to createVault(name, { type: 'fast', ...options })
   */
  async createFastVault(options: {
    name: string
    password: string
    email: string
  }): Promise<{
    vault: Vault
    vaultId: string
    verificationRequired: boolean
  }> {
    await this.ensureInitialized()

    // Create vault with internal progress handling
    const vault = await this.vaultManager.createVault(options.name, {
      type: 'fast',
      password: options.password,
      email: options.email,
      onProgressInternal: (step, vaultRef) => {
        // Emit progress events with vault reference (undefined early, then populated)
        this.emit('vaultCreationProgress', { vault: vaultRef, step })
      },
    })

    const vaultId = vault.data.publicKeys.ecdsa

    // Emit completion event
    this.emit('vaultCreationComplete', { vault })

    // Save to storage and emit vaultChanged event
    await this.saveVaultToStorage(vault)
    this.emit('vaultChanged', { vaultId })

    return {
      vault,
      vaultId,
      verificationRequired: true,
    }
  }

  /**
   * Verify fast vault with email code
   */
  async verifyVault(vaultId: string, code: string): Promise<boolean> {
    await this.ensureInitialized()
    return this.serverManager.verifyVault(vaultId, code)
  }

  /**
   * Get vault from VultiServer
   *
   * Note: This method currently has limitations as getVaultFromServer
   * returns incomplete data. Consider using importVault() with a .vult file instead.
   */
  async getVault(vaultId: string, password: string): Promise<Vault> {
    await this.ensureInitialized()
    const coreVault = await this.serverManager.getVaultFromServer(
      vaultId,
      password
    )

    // TODO: This is incomplete - getVaultFromServer doesn't return full vault data
    // We need to build VaultData from CoreVault, but we're missing the .vult content
    // For now, create a minimal VaultData
    const nextId = await this.vaultManager['getNextVaultId']()

    const vaultData: import('./types').VaultData = {
      id: nextId,
      publicKeyEcdsa: coreVault.publicKeys.ecdsa,
      publicKeyEddsa: coreVault.publicKeys.eddsa,
      name: coreVault.name,
      isEncrypted: true,
      type: coreVault.signers.some(s => s.startsWith('Server-'))
        ? 'fast'
        : 'secure',
      createdAt: coreVault.createdAt || Date.now(),
      lastModified: Date.now(),
      currency: 'usd',
      chains: [],
      tokens: {},
      threshold: Object.keys(coreVault.keyShares).length,
      totalSigners: coreVault.signers.length,
      vaultIndex: coreVault.order,
      signers: coreVault.signers.map(s => ({
        id: s,
        publicKey: s.startsWith('Server-') ? s : coreVault.publicKeys.ecdsa,
        name: s,
      })),
      hexChainCode: coreVault.hexChainCode,
      hexEncryptionKey: '',
      vultFileContent: '', // Missing - this is a problem!
      isBackedUp: coreVault.isBackedUp,
    }

    // Save to storage
    await this.storage.set(`vault:${nextId}`, vaultData)
    await this.storage.set('activeVaultId', nextId)

    // Create Vault instance
    const vault = this.vaultManager.createVaultInstance(nextId, vaultData)

    this.emit('vaultChanged', { vaultId: nextId.toString() })

    return vault
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
   * Import vault from file path (Node.js only)
   *
   * Provides a convenient way to import vaults from file paths in Node.js.
   * In browser environments, use importVault() with file content instead.
   *
   * @param filePath - Absolute path to vault file (Node.js only)
   * @param password - Optional password for encrypted vaults
   * @returns Imported vault instance
   * @throws Error if not running in Node.js environment
   *
   * @example
   * ```typescript
   * // Node.js
   * const vault = await sdk.importVaultFromFile('/path/to/vault.vult', 'password')
   * ```
   */
  async importVaultFromFile(
    filePath: string,
    password?: string
  ): Promise<Vault> {
    if (!isNode()) {
      throw new Error(
        'importVaultFromFile can only be called in Node.js environment. Use importVault() with file content in browsers.'
      )
    }

    // Dynamically import Node.js modules
    const fs = await import('fs/promises')

    // Read file as UTF-8 string
    const vultContent = await fs.readFile(filePath, 'utf-8')

    // Use existing importVault method
    return this.importVault(vultContent, password)
  }

  /**
   * Export vault to .vult file content
   *
   * @param vaultId - Numeric vault ID
   * @returns Base64-encoded .vult file content
   *
   * @example
   * ```typescript
   * const vultContent = await sdk.exportVault(0)
   * fs.writeFileSync('backup.vult', vultContent)
   * ```
   */
  async exportVault(vaultId: number): Promise<string> {
    await this.ensureInitialized()
    return this.vaultManager.exportVault(vaultId)
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
   * Switch to different vault
   */
  async setActiveVault(vault: Vault): Promise<void> {
    await this.vaultManager.setActiveVault(vault.id)
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

  /**
   * Get all vault instances (convenience method)
   * Equivalent to listVaults()
   *
   * @returns Array of all vault instances
   */
  async getAllVaults(): Promise<Vault[]> {
    return this.vaultManager.getAllVaults()
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  async setDefaultCurrency(currency: string): Promise<void> {
    this.defaultCurrency = currency
    await this.storage.set('config:defaultCurrency', currency)
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.defaultCurrency
  }

  // === CHAIN OPERATIONS ===

  /**
   * Get all hardcoded supported chains (immutable)
   */
  getSupportedChains(): string[] {
    return getSupportedChains()
  }

  /**
   * Set SDK-level default chains for new vaults
   */
  async setDefaultChains(chains: string[]): Promise<void> {
    // Validate chains (will throw if invalid)
    const validatedChains = validateChains(chains)
    this.defaultChains = validatedChains
    await this.storage.set('config:defaultChains', validatedChains)
  }

  /**
   * Get SDK-level default chains (returns a copy for immutability)
   */
  getDefaultChains(): string[] {
    return [...this.defaultChains]
  }

  // === VALIDATION HELPERS ===

  /**
   * Validate email format
   */
  static validateEmail(email: string): ValidationResult {
    return ValidationHelpers.validateEmail(email)
  }

  /**
   * Validate password strength
   */
  static validatePassword(password: string): ValidationResult {
    return ValidationHelpers.validatePassword(password)
  }

  /**
   * Validate vault name
   */
  static validateVaultName(name: string): ValidationResult {
    return ValidationHelpers.validateVaultName(name)
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

  // === SIGNING OPERATIONS ===

  /**
   * Sign transaction with the active vault using fast signing mode
   * Only works with fast vaults (vaults with VultiServer)
   */
  async signTransaction(
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    await this.ensureInitialized()
    const activeVault = await this.getActiveVault()
    if (!activeVault) {
      throw new Error('No active vault. Please set an active vault first.')
    }
    return activeVault.sign('fast', payload, password)
  }

  /**
   * Sign transaction with a specific vault using fast signing mode
   */
  async signTransactionWithVault(
    vault: Vault,
    payload: SigningPayload,
    password: string
  ): Promise<Signature> {
    await this.ensureInitialized()
    return vault.sign('fast', payload, password)
  }

  // === SDK STATE MANAGEMENT ===

  /**
   * Set active chain and persist to storage
   */
  async setActiveChain(chain: Chain): Promise<void> {
    this.activeChain = chain
    await this.storage.set('activeChain', chain)
    this.emit('chainChanged', { chain })
  }

  /**
   * Get active chain from storage or memory
   */
  async getActiveChain(): Promise<Chain> {
    // Try storage first
    const stored = await this.storage.get<Chain>('activeChain')
    return stored ?? this.activeChain
  }

  /**
   * Switch to different vault by ID
   * Loads vault from storage and sets as active
   */
  async switchVault(vaultId: number): Promise<void> {
    try {
      await this.loadVaultFromStorage(vaultId)
      this.emit('vaultChanged', { vaultId: vaultId.toString() })
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // === STORAGE QUOTA MONITORING ===

  /**
   * Check storage quota and return usage statistics
   */
  async getStorageInfo(): Promise<{
    usage: number
    quota?: number
    percentage?: number
    isNearLimit: boolean
  }> {
    const usage = (await this.storage.getUsage?.()) ?? 0
    const quota = await this.storage.getQuota?.()

    const percentage = quota ? (usage / quota) * 100 : undefined
    const isNearLimit = percentage ? percentage > 80 : false

    // Emit warning if storage is >80% full
    if (isNearLimit) {
      console.warn(
        `Storage usage is ${percentage?.toFixed(1)}% full (${usage} / ${quota} bytes). Consider clearing old data.`
      )
    }

    return {
      usage,
      quota,
      percentage,
      isNearLimit,
    }
  }

  /**
   * Clear all SDK data from storage
   * Warning: This will remove all vaults, address book, and configuration
   */
  async clearAllData(): Promise<void> {
    await this.storage.clear()
    this.emit('dataCleared', {})
  }

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }

  getWasmManager(): WASMManager {
    return this.wasmManager
  }
}
