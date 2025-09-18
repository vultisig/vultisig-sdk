import type {
  Vault,
  ServerStatus,
  KeygenProgressUpdate,
  AddressBook,
  AddressBookEntry,
  ValidationResult
} from './types'

import { ServerManager } from './server'
import { WASMManager } from './wasm'
import { Vault as VaultClass } from './vault/Vault'
import { AddressBookManager } from './vault/AddressBook'
import { ChainManagement } from './vault/ChainManagement'
import { VaultManagement } from './vault/VaultManagement'
import { ValidationHelpers } from './vault/utils/validation'

/**
 * Main Vultisig class providing secure multi-party computation and blockchain operations
 */
export class Vultisig {
  private serverManager: ServerManager
  private wasmManager: WASMManager
  private initialized = false
  
  // Module managers
  private addressBookManager: AddressBookManager
  private chainManagement: ChainManagement
  private vaultManagement: VaultManagement

  constructor(config?: {
    serverEndpoints?: {
      fastVault?: string
      messageRelay?: string
    }
    wasmConfig?: {
      autoInit?: boolean
      wasmPaths?: {
        walletCore?: string
        dkls?: string
        schnorr?: string
      }
    }
    defaultChains?: string[]
    defaultCurrency?: string
  }) {
    this.wasmManager = new WASMManager(config?.wasmConfig)
    this.serverManager = new ServerManager(config?.serverEndpoints)
    
    // Initialize module managers
    this.addressBookManager = new AddressBookManager()
    this.chainManagement = new ChainManagement({
      defaultChains: config?.defaultChains,
      defaultCurrency: config?.defaultCurrency
    })
    this.vaultManagement = new VaultManagement(this.wasmManager, this)
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
   * Initialize the SDK and load WASM modules
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
    return this.vaultManagement.createVault(name, options)
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<VaultClass> {
    await this.ensureInitialized()
    return this.vaultManagement.addVault(file, password)
  }

  /**
   * List all stored vaults
   */
  async listVaults(): Promise<any[]> {
    await this.ensureInitialized()
    return this.vaultManagement.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultClass): Promise<void> {
    await this.ensureInitialized()
    return this.vaultManagement.deleteVault(vault)
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    await this.ensureInitialized()
    await this.vaultManagement.clearVaults()
    this.addressBookManager.clear()
  }

  // === ACTIVE VAULT MANAGEMENT ===

  /**
   * Switch to different vault
   */
  setActiveVault(vault: VaultClass): void {
    this.vaultManagement.setActiveVault(vault)
  }

  /**
   * Get current active vault
   */
  getActiveVault(): VaultClass | null {
    return this.vaultManagement.getActiveVault()
  }

  /**
   * Check if there's an active vault
   */
  hasActiveVault(): boolean {
    return this.vaultManagement.hasActiveVault()
  }

  // === GLOBAL CONFIGURATION ===

  /**
   * Set global default currency
   */
  setDefaultCurrency(currency: string): void {
    this.chainManagement.setDefaultCurrency(currency)
  }

  /**
   * Get global default currency
   */
  getDefaultCurrency(): string {
    return this.chainManagement.getDefaultCurrency()
  }

  // === CHAIN OPERATIONS ===

  /**
   * Get all hardcoded supported chains (immutable)
   */
  getSupportedChains(): string[] {
    return this.chainManagement.getSupportedChains()
  }

  /**
   * Set SDK-level default chains for new vaults
   */
  setDefaultChains(chains: string[]): void {
    this.chainManagement.setDefaultChains(chains)
  }

  /**
   * Get SDK-level default chains
   */
  getDefaultChains(): string[] {
    return this.chainManagement.getDefaultChains()
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
    return this.vaultManagement.isVaultFileEncrypted(file)
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

  // === INTERNAL ACCESS FOR VAULT ===

  getServerManager(): ServerManager {
    return this.serverManager
  }
}
