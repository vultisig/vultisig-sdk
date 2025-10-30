// ServerManager is internal - import directly from implementation file
import { ServerManager } from './server/ServerManager'
import {
  AddressBook,
  AddressBookEntry,
  ServerStatus,
  Signature,
  SigningPayload,
  ValidationResult,
} from './types'
import { AddressBookManager } from './vault/AddressBook'
import { ChainManager } from './ChainManager'
import { ValidationHelpers } from './vault/utils/validation'
import { Vault as VaultClass } from './vault/Vault'
import { VaultManager } from './VaultManager'
import { WASMManager } from './wasm'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 */
export class Vultisig {
  private serverManager: ServerManager
  private initialized = false

  // Module managers
  private addressBookManager: AddressBookManager
  private chainManager: ChainManager
  private vaultManager: VaultManager

  constructor(config?: {
    serverEndpoints?: {
      fastVault?: string
      messageRelay?: string
    }

    defaultChains?: string[]
    defaultCurrency?: string
  }) {
    this.serverManager = new ServerManager(config?.serverEndpoints)

    // Initialize module managers
    this.addressBookManager = new AddressBookManager()
    this.chainManager = new ChainManager({
      defaultChains: config?.defaultChains,
      defaultCurrency: config?.defaultCurrency,
    })
    this.vaultManager = new VaultManager(this)
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
      await WASMManager.getInstance().initialize()
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
    return this.vaultManager.createVault(name, options)
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

    return {
      vault,
      vaultId: vault.data.publicKeys.ecdsa,
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

    // Create VaultClass instance
    const vault = new VaultClass(
      vaultData,
      this
    )

    // Store the vault and set as active
    this.vaultManager.setActiveVault(vault)

    return vault
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<VaultClass> {
    await this.ensureInitialized()
    return this.vaultManager.addVault(file, password)
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
    return this.vaultManager.deleteVault(vault)
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await this.vaultManager.clearVaults()
    this.addressBookManager.clear()
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
    this.chainManager.setDefaultCurrency(currency)
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.chainManager.getDefaultCurrency()
  }

  // === CHAIN OPERATIONS ===

  /**
   * Get all hardcoded supported chains (immutable)
   */
  getSupportedChains(): string[] {
    return this.chainManager.getSupportedChains()
  }

  /**
   * Set SDK-level default chains for new vaults
   */
  setDefaultChains(chains: string[]): void {
    this.chainManager.setDefaultChains(chains)
  }

  /**
   * Get SDK-level default chains
   */
  getDefaultChains(): string[] {
    return this.chainManager.getDefaultChains()
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

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }
}
