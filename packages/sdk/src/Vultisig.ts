// ServerManager is internal - import directly from implementation file
import { ServerManager } from './server/ServerManager'
import {
  AddressBook,
  AddressBookEntry,
  ServerStatus,
  Signature,
  SigningPayload,
  Summary,
  ValidationResult,
  VultisigConfig,
} from './types'
import { AddressBookManager } from './AddressBookManager'
import {
  DEFAULT_CHAINS,
  getSupportedChains,
  validateChains,
} from './ChainManager'
import { Vault as VaultClass } from './vault/Vault'
import { VaultManager } from './VaultManager'
import { WASMManager } from './wasm'
import { UniversalEventEmitter } from './events/EventEmitter'
import type { SdkEvents } from './events/types'
import type { VaultStorage } from './runtime/storage/types'
import { StorageManager } from './runtime/storage/StorageManager'
import { Chain } from '@core/chain/Chain'
import { ValidationHelpers } from './utils/validation'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 * Now with integrated storage, events, and connection management
 */
export class Vultisig extends UniversalEventEmitter<SdkEvents> {
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false

  // Module managers
  private addressBookManager: AddressBookManager
  private vaultManager: VaultManager

  // Chain and currency configuration
  private defaultChains: string[]
  private defaultCurrency: string

  // Storage and connection state
  private storage: VaultStorage
  private connected = false
  private activeChain: string

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
    this.addressBookManager = new AddressBookManager()
    this.vaultManager = new VaultManager(this.wasmManager, this.serverManager, {
      defaultChains: config?.defaultChains,
      defaultCurrency: config?.defaultCurrency,
    })

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
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      await this.wasmManager.initialize()
      this.initialized = true
    } catch (error) {
      throw new Error('Failed to initialize SDK: ' + (error as Error).message)
    }
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
  async connect(options?: {
    vaultId?: string
    password?: string
  }): Promise<void> {
    try {
      // Initialize WASM modules
      await this.initialize()

      if (options?.vaultId) {
        // Load specific vault
        await this.loadVaultFromStorage(options.vaultId, options.password)
      } else {
        // Auto-load last active vault
        await this.loadLastActiveVault()
      }

      this.connected = true
      this.emit('connect', undefined)
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  /**
   * Disconnect and clear active vault
   */
  async disconnect(): Promise<void> {
    this.vaultManager.setActiveVault(null as any)
    this.connected = false
    this.emit('disconnect', undefined)
  }

  /**
   * Check if connected with active vault
   */
  isConnected(): boolean {
    return this.connected && this.hasActiveVault()
  }

  /**
   * Load vault from storage by ID
   * @private
   */
  private async loadVaultFromStorage(
    vaultId: string,
    password?: string
  ): Promise<void> {
    const vaultData = await this.storage.get<Summary>(`vault:${vaultId}`)
    if (!vaultData) {
      throw new Error(`Vault not found: ${vaultId}`)
    }

    // Reconstruct File-like object from vault data
    const blob = new Blob([JSON.stringify(vaultData)], {
      type: 'application/json',
    })
    const file = new File([blob], `${vaultData.name}.vult`)

    // Import vault using existing method
    const vault = await this.addVault(file, password)

    // Emit event
    this.emit('vaultChanged', { vaultId })
  }

  /**
   * Load last active vault from storage
   * @private
   */
  private async loadLastActiveVault(): Promise<void> {
    const lastVaultId = await this.storage.get<string>('activeVaultId')
    if (lastVaultId) {
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
  private async saveVaultToStorage(vault: VaultClass): Promise<void> {
    const summary = vault.summary()
    const vaultId = summary.id

    // Store vault summary
    await this.storage.set(`vault:${vaultId}`, summary)

    // Store as last active
    await this.storage.set('activeVaultId', vaultId)
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
      onProgress?: (step: any) => void
    }
  ): Promise<VaultClass> {
    await this.ensureInitialized()
    const vault = await this.vaultManager.createVault(name, options)

    // Save to storage and emit event
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
    onProgress?: (step: any) => void
  }): Promise<{
    vault: VaultClass
    vaultId: string
    verificationRequired: boolean
  }> {
    await this.ensureInitialized()
    const vault = await this.vaultManager.createVault(options.name, {
      type: 'fast',
      password: options.password,
      email: options.email,
      onProgress: options.onProgress,
    })

    const vaultId = vault.data.publicKeys.ecdsa

    // Save to storage and emit event
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
   */
  async getVault(vaultId: string, password: string): Promise<VaultClass> {
    await this.ensureInitialized()
    const vaultData = await this.serverManager.getVaultFromServer(
      vaultId,
      password
    )

    // Create VaultClass instance using VaultManager's service creation
    // This ensures consistent service instantiation across all vault creation paths
    const vault = this.vaultManager.createVaultInstance(vaultData)

    // Store the vault and set as active
    this.vaultManager.setActiveVault(vault)

    // Save to storage and emit event
    await this.saveVaultToStorage(vault)
    this.emit('vaultChanged', { vaultId })

    return vault
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<VaultClass> {
    await this.ensureInitialized()
    const vault = await this.vaultManager.addVault(file, password)

    // Save to storage and emit event
    await this.saveVaultToStorage(vault)
    this.emit('vaultChanged', { vaultId: vault.summary().id })

    return vault
  }

  /**
   * List all stored vaults
   */
  async listVaults(): Promise<any[]> {
    await this.ensureInitialized()
    return this.vaultManager.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultClass): Promise<void> {
    await this.ensureInitialized()
    const vaultId = vault.summary().id

    // Delete from VaultManager
    await this.vaultManager.deleteVault(vault)

    // Remove from storage
    await this.storage.remove(`vault:${vaultId}`)

    // Clear active vault ID if this was the active vault
    const activeVaultId = await this.storage.get<string>('activeVaultId')
    if (activeVaultId === vaultId) {
      await this.storage.remove('activeVaultId')
    }

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
  setActiveVault(vault: VaultClass): void {
    this.vaultManager.setActiveVault(vault)
  }

  /**
   * Get current active vault
   */
  getActiveVault(): VaultClass | null {
    return this.vaultManager.getActiveVault()
  }

  /**
   * Check if there's an active vault
   */
  hasActiveVault(): boolean {
    return this.vaultManager.hasActiveVault()
  }

  // === GLOBAL CONFIGURATION ===

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
  setDefaultChains(chains: string[]): void {
    // Validate chains (will throw if invalid)
    const validatedChains = validateChains(chains)
    this.defaultChains = validatedChains
    // TODO: Save config to storage
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
  async isVaultFileEncrypted(file: File): Promise<boolean> {
    return this.vaultManager.isVaultFileEncrypted(file)
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
  async getAddressBook(chain?: string): Promise<AddressBook> {
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
    addresses: Array<{ chain: string; address: string }>
  ): Promise<void> {
    return this.addressBookManager.removeAddressBookEntry(addresses)
  }

  /**
   * Update address book entry name
   */
  async updateAddressBookEntry(
    chain: string,
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
    const activeVault = this.getActiveVault()
    if (!activeVault) {
      throw new Error('No active vault. Please set an active vault first.')
    }
    return activeVault.sign('fast', payload, password)
  }

  /**
   * Sign transaction with a specific vault using fast signing mode
   */
  async signTransactionWithVault(
    vault: VaultClass,
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
  async setActiveChain(chain: string): Promise<void> {
    this.activeChain = chain
    await this.storage.set('activeChain', chain)
    this.emit('chainChanged', { chain })
  }

  /**
   * Get active chain from storage or memory
   */
  async getActiveChain(): Promise<string> {
    // Try storage first
    const stored = await this.storage.get<string>('activeChain')
    return stored ?? this.activeChain
  }

  /**
   * Switch to different vault by ID
   * Loads vault from storage and sets as active
   */
  async switchVault(vaultId: string): Promise<void> {
    try {
      await this.loadVaultFromStorage(vaultId)
      this.emit('vaultChanged', { vaultId })
    } catch (error) {
      this.emit('error', error as Error)
      throw error
    }
  }

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }

  getWasmManager(): WASMManager {
    return this.wasmManager
  }
}
