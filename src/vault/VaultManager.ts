import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/ui/vault/import/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'
import { FastVaultClient } from '../server'
import { AddressBookManager } from './AddressBookManager'

import type {
  AddressBook,
  AddressBookEntry,
  KeygenMode,
  Summary,
  Vault,
  VaultCreationStep,
  VaultDetails,
  VaultManagerConfig,
  VaultType,
  VaultValidationResult,
} from '../types'
import { Vault as VaultClass } from './Vault'
import { VaultImportError, VaultImportErrorCode } from './VaultError'

/**
 * Validate if a vault is a legitimate server-assisted fast vault
 * Checks if the vault exists on the server with the provided password
 */
async function validateVaultWithServer(
  vaultId: string,
  password: string
): Promise<boolean> {
  try {
    const client = new FastVaultClient()
    console.log('Attempting server validation for vault:', vaultId)
    const result = await client.getVault(vaultId, password)
    console.log('Server validation successful:', result)
    return true
  } catch (error: any) {
    console.error('Server validation failed for vault:', vaultId)
    console.error('Error details:', {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      code: error.code
    })
    
    // Check if it's a legitimate vault not found (404) vs server/network issues
    if (error.response?.status === 404) {
      console.log('Vault not found on server (404) - not a fast vault')
      return false
    }
    
    return false
  }
}

/**
 * Determine vault type based on server validation only
 * Fast vaults must be validated against the server - no fallbacks
 * All other vaults are classified as secure
 */
async function determineVaultType(
  signers: string[],
  vaultId?: string,
  password?: string
): Promise<'fast' | 'secure'> {
  // Only attempt server validation if we have the necessary info
  if (vaultId && password) {
    const isValidServerVault = await validateVaultWithServer(vaultId, password)
    if (isValidServerVault) {
      return 'fast'
    }
  }

  // If server validation fails or is unavailable, classify as secure
  return 'secure'
}

/**
 * VaultManager handles multiple vaults and global vault operations
 * Following the vault-centric architecture with static methods
 */
export class VaultManager {
  // === GLOBAL SETTINGS ===
  private static config: VaultManagerConfig = {
    defaultChains: ['bitcoin', 'ethereum'],
    defaultCurrency: 'USD',
  }
  private static sdkInstance: any | null = null
  private static activeVault: VaultClass | null = null
  private static vaultStorage = new Map<string, Vault>()
  private static vaultSecurityTypes = new Map<string, 'fast' | 'secure'>()
  private static vaultPasswords = new Map<string, string>()
  // === INITIALIZATION ===
  /**
   * Initialize VaultManager with SDK instance and configuration
   */
  static init(sdk: any, config?: Partial<VaultManagerConfig>): void {
    this.sdkInstance = sdk
    if (config) {
      this.config = { ...this.config, ...config }
    }
  }

  /**
   * Read file as ArrayBuffer (works in both browser and Node.js)
   */
  private static async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    // Check if we're in a browser environment
    if (typeof FileReader !== 'undefined') {
      // Use File.arrayBuffer() method which is now standard
      return file.arrayBuffer()
    }

    // For Node.js/test environment, use the file's internal buffer
    // This is a workaround for testing - in production this would use FileReader
    const fileData = (file as any).buffer || (file as any)._buffer
    if (fileData) {
      return fileData
    }

    throw new Error(
      'Unable to read file: FileReader not available and no internal buffer found'
    )
  }

  // === VAULT LIFECYCLE ===
  /**
   * Create new vault (automatically applies global chains/currency)
   */
  static async create(
    _name: string,
    _options?: {
      type?: VaultType
      keygenMode?: KeygenMode
      password?: string
      email?: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<VaultClass> {
    throw new Error(
      'create() not implemented yet - requires MPC keygen integration'
    )
  }

  /**
   * Add a vault from a .vult file to the VaultManager
   * Automatically applies global settings (chains, currency) to the imported vault
   * @param file - The .vult file to import
   * @param password - Optional password for encrypted vaults
   * @returns Promise<VaultClass> - The imported and normalized vault
   */
  static async add(file: File, password?: string): Promise<VaultClass> {
    try {
      // Validate file type
      if (!file.name.toLowerCase().endsWith('.vult')) {
        throw new VaultImportError(
          VaultImportErrorCode.INVALID_FILE_FORMAT,
          'Only .vult files are supported for vault import'
        )
      }

      // Read file as ArrayBuffer
      const buffer = await this.readFileAsArrayBuffer(file)

      // Decode as UTF-8 string (base64 content)
      const base64Content = new TextDecoder().decode(buffer)

      // Parse VaultContainer protobuf
      const container = vaultContainerFromString(base64Content.trim())

      let vaultBase64: string

      // Handle encryption
      if (container.isEncrypted) {
        if (!password) {
          throw new VaultImportError(
            VaultImportErrorCode.PASSWORD_REQUIRED,
            'Password is required to decrypt this vault'
          )
        }

        try {
          // Decrypt the vault data
          const encryptedData = fromBase64(container.vault)
          const decryptedBuffer = await decryptWithAesGcm({
            key: password,
            value: encryptedData,
          })

          // Convert decrypted data back to base64 for parsing
          vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
        } catch (error) {
          throw new VaultImportError(
            VaultImportErrorCode.INVALID_PASSWORD,
            'Invalid password for encrypted vault',
            error as Error
          )
        }
      } else {
        // Unencrypted vault - use directly
        vaultBase64 = container.vault
      }

      // Decode and parse the inner Vault protobuf
      const vaultBinary = fromBase64(vaultBase64)
      const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)

      // Convert to Vault object
      const vault = fromCommVault(vaultProtobuf)

      // Normalize vault with static properties
      const normalizedVault = this.normalizeVault(vault)

      // Fetch dynamic details including server validation
      const isEncrypted = container.isEncrypted
      const dynamicDetails = await this.fetchVaultDetails(normalizedVault, password)

      // Store the vault data
      this.vaultStorage.set(normalizedVault.publicKeys.ecdsa, normalizedVault)

      // Create VaultClass instance
      const vaultInstance = new VaultClass(
        normalizedVault,
        this.sdkInstance?.wasmManager?.getWalletCore()
      )

      // Set cached properties on the Vault instance
      vaultInstance.setCachedEncryptionStatus(isEncrypted)
      vaultInstance.setCachedSecurityType(dynamicDetails.securityType)

      // Store static properties in VaultManager
      const vaultId = normalizedVault.publicKeys.ecdsa
      this.vaultSecurityTypes.set(vaultId, dynamicDetails.securityType)
      if (password) {
        this.vaultPasswords.set(vaultId, password)
      }

      return vaultInstance
    } catch (error) {
      // Re-throw VaultImportError instances
      if (error instanceof VaultImportError) {
        throw error
      }

      // Wrap other errors
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to import vault: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Load vault, applies global settings (chains/currency), makes active
   */
  static async load(vault: VaultClass, _password?: string): Promise<void> {
    // Apply global settings to the vault
    this.applyConfig(vault)

    // Set as active vault
    this.setActive(vault)
  }

  /**
   * List all stored vaults with their summaries
   */
  static async list(): Promise<Summary[]> {
    const summaries: Summary[] = []

    for (const [, vault] of this.vaultStorage) {
      const vaultInstance = new VaultClass(
        vault,
        this.sdkInstance?.wasmManager?.getWalletCore()
      )
      const summary = await vaultInstance.summary()
      
      // Get cached security type for this vault
      const vaultId = vault.publicKeys.ecdsa
      const cachedSecurityType = this.vaultSecurityTypes.get(vaultId) || 'secure'

      const fullSummary: Summary = {
        id: summary.id,
        name: summary.name,
        type: cachedSecurityType as VaultType,
        chains: summary.chains,
        createdAt: summary.createdAt ?? Date.now(),
        isBackedUp: () => vault.isBackedUp ?? false,
        isEncrypted: vaultInstance.getCachedEncryptionStatus() ?? false, // Use cached encryption status
        lastModified: vault.createdAt ?? Date.now(),
        size: 0, // Vault size calculation not implemented
        threshold:
          vault.threshold ?? this.calculateThreshold(vault.signers.length),
        totalSigners: vault.signers.length,
        vaultIndex: vault.localPartyId ? parseInt(vault.localPartyId) : 0,
        signers: vault.signers.map((signerId, index) => ({
          id: signerId,
          publicKey: '', // Signer public key mapping not implemented
          name: `Signer ${index + 1}`,
        })),
        keys: {
          ecdsa: vault.publicKeys.ecdsa,
          eddsa: vault.publicKeys.eddsa,
          hexChainCode: vault.hexChainCode,
          hexEncryptionKey: '', // Encryption key not stored for security
        },
        currency: this.config.defaultCurrency,
        tokens: {}, // Token management not implemented
      }

      summaries.push(fullSummary)
    }

    return summaries
  }

  /**
   * Remove vault from storage
   */
  static async remove(vault: VaultClass): Promise<void> {
    const vaultId = vault.data.publicKeys.ecdsa
    this.vaultStorage.delete(vaultId)
    this.vaultSecurityTypes.delete(vaultId)
    this.vaultPasswords.delete(vaultId)

    // Clear active vault if it was the removed one
    if (this.activeVault?.data.publicKeys.ecdsa === vaultId) {
      this.activeVault = null
    }
  }

  /**
   * Clear all stored vaults
   */
  static async clear(): Promise<void> {
    this.vaultStorage.clear()
    this.vaultSecurityTypes.clear()
    this.vaultPasswords.clear()
    this.activeVault = null
    await AddressBookManager.clear()
  }

  // === ACTIVE VAULT MANAGEMENT ===
  /**
   * Set active vault
   */
  static setActive(vault: VaultClass): void {
    this.activeVault = vault
  }

  /**
   * Get current active vault
   */
  static getActive(): VaultClass | null {
    return this.activeVault
  }

  /**
   * Check if there's an active vault
   */
  static hasActive(): boolean {
    return this.activeVault !== null
  }

  // === GLOBAL CONFIGURATION ===
  /**
   * Set global default chains
   */
  static async setDefaultChains(chains: string[]): Promise<void> {
    this.config.defaultChains = chains
  }

  /**
   * Get global default chains
   */
  static getDefaultChains(): string[] {
    return this.config.defaultChains
  }

  /**
   * Set global default currency
   */
  static async setDefaultCurrency(currency: string): Promise<void> {
    this.config.defaultCurrency = currency
  }

  /**
   * Get global default currency
   */
  static getDefaultCurrency(): string {
    return this.config.defaultCurrency
  }

  /**
   * Save configuration
   */
  static async saveConfig(config: Partial<VaultManagerConfig>): Promise<void> {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get current configuration
   */
  static getConfig(): VaultManagerConfig {
    return { ...this.config }
  }

  // === ADDRESS BOOK (DELEGATED) ===
  /**
   * Get address book entries (delegates to AddressBookManager)
   */
  static async addressBook(chain?: string): Promise<AddressBook> {
    return AddressBookManager.get(chain)
  }

  /**
   * Add address book entries (delegates to AddressBookManager)
   */
  static async addAddressBookEntry(entries: AddressBookEntry[]): Promise<void> {
    return AddressBookManager.add(entries)
  }

  /**
   * Remove address book entries (delegates to AddressBookManager)
   */
  static async removeAddressBookEntry(
    addresses: Array<{ chain: string; address: string }>
  ): Promise<void> {
    return AddressBookManager.remove(addresses)
  }

  /**
   * Update address book entry name (delegates to AddressBookManager)
   */
  static async updateAddressBookEntry(
    chain: string,
    address: string,
    name: string
  ): Promise<void> {
    return AddressBookManager.update(chain, address, name)
  }

  // === VAULT SETTINGS INHERITANCE ===
  /**
   * Apply global chains/currency to vault
   */
  private static applyConfig(vault: VaultClass): VaultClass {
    // Global settings application not implemented
    return vault
  }

  /**
   * Normalize vault with static properties that don't change
   * @param vault - The vault to normalize
   * @returns Vault - The vault with static properties applied
   */
  private static normalizeVault(vault: Vault): Vault {
    const threshold = this.calculateThreshold(vault.signers.length)

    return {
      ...vault,
      threshold,
      isBackedUp: true, // Imported vaults are considered backed up
      createdAt: vault.createdAt ?? Date.now(),
      keyShares: vault.keyShares ?? { ecdsa: '', eddsa: '' },
      libType: vault.libType ?? 'DKLS',
      order: vault.order ?? 0,
    }
  }

  /**
   * Fetch dynamic vault details that may change or require server validation
   * @param vault - The vault to fetch details for
   * @param password - Password for server validation
   * @returns Object with dynamic properties
   */
  private static async fetchVaultDetails(vault: Vault, password?: string) {
    const vaultId = vault.publicKeys.ecdsa
    const securityType = await determineVaultType(vault.signers, vaultId, password)

    return {
      securityType,
      // Future: balances, gas prices, etc. would go here
    }
  }

  /**
   * Static method to check if a vault file is encrypted
   * This checks the VaultContainer.is_encrypted property which indicates
   * whether the entire vault file is password-encrypted with AES-256-GCM
   */
  static async isEncrypted(file: File): Promise<boolean> {
    try {
      // Read file as ArrayBuffer
      const buffer = await this.readFileAsArrayBuffer(file)

      // Decode as UTF-8 string (base64 content)
      const base64Content = new TextDecoder().decode(buffer)

      // Parse VaultContainer protobuf to check encryption flag
      const container = vaultContainerFromString(base64Content.trim())

      return container.isEncrypted
    } catch (error) {
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to check encryption status: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Static method to get cached encryption status from a vault instance
   * This avoids re-decoding the vault file if the status is already cached
   */
  static getCachedEncryptionStatus(vault: VaultClass): boolean | undefined {
    return vault.getCachedEncryptionStatus()
  }

  /**
   * Static method to get cached security type from a vault instance
   * This avoids re-calculating the security type if it's already cached
   */
  static getCachedSecurityType(vault: VaultClass): 'fast' | 'secure' | undefined {
    return vault.getCachedSecurityType()
  }

  /**
   * Static method to get encryption status with fallback to file-based checking
   * If the vault has cached encryption status, returns it; otherwise checks the file
   */
  static async getEncryptionStatus(vault: VaultClass, file?: File): Promise<boolean> {
    // Try to get cached value first
    const cached = this.getCachedEncryptionStatus(vault)
    if (cached !== undefined) {
      return cached
    }

    // If no file provided and no cache, we can't determine encryption status
    if (!file) {
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        'Cannot determine encryption status: no cached value and no file provided'
      )
    }

    // Fall back to file-based checking
    const isEncrypted = await this.isEncrypted(file)

    // Cache the result for future use
    vault.setCachedEncryptionStatus(isEncrypted)

    return isEncrypted
  }

  /**
   * Static method to get security type using cached value or server validation
   * Uses cached security type if available, otherwise performs server validation
   */
  static async getSecurityType(vault: VaultClass, password?: string): Promise<'fast' | 'secure'> {
    const vaultId = vault.data.publicKeys.ecdsa

    // Check if we have cached security type
    const cachedSecurityType = this.vaultSecurityTypes.get(vaultId)
    if (cachedSecurityType) {
      return cachedSecurityType
    }

    // If not cached, perform server validation
    const storedPassword = password || this.vaultPasswords.get(vaultId)
    const securityType = await determineVaultType(vault.data.signers, vaultId, storedPassword)
    
    // Cache the result
    this.vaultSecurityTypes.set(vaultId, securityType)
    vault.setCachedSecurityType(securityType)

    return securityType
  }


  /**
   * Calculate the threshold for a given number of participants
   * Formula: 2/3rds of participants (rounded up) with minimum of 2
   */
  private static calculateThreshold(participantCount: number): number {
    if (participantCount < 2) {
      throw new Error('Vault must have at least 2 participants')
    }

    // Calculate 2/3rds and round up, with minimum of 2
    const twoThirds = Math.ceil((participantCount * 2) / 3)
    return Math.max(2, twoThirds)
  }

  /**
   * Get vault details and metadata
   */
  static async getVaultDetails(vault: Vault, password?: string): Promise<VaultDetails> {
    const vaultId = vault.publicKeys.ecdsa || 'unknown'
    
    // Get cached security type or perform server validation
    const cachedSecurityType = this.vaultSecurityTypes.get(vaultId)
    const securityType = cachedSecurityType || 
      await determineVaultType(vault.signers, vaultId, password || this.vaultPasswords.get(vaultId))
    
    // Cache if not already cached
    if (!cachedSecurityType) {
      this.vaultSecurityTypes.set(vaultId, securityType)
    }

    return {
      name: vault.name,
      id: vaultId,
      securityType,
      threshold:
        vault.threshold ??
        VaultManager.calculateThreshold(vault.signers.length), // Fallback for legacy vaults
      participants: vault.signers.length,
      chains: [], // Will be derived from public keys - requires chain integration
      createdAt: vault.createdAt,
      isBackedUp: vault.isBackedUp,
    }
  }

  /**
   * Validate vault structure and integrity
   */
  static validateVault(vault: Vault): VaultValidationResult {
    const errors: string[] = []
    const warnings: string[] = []

    // Basic validation
    if (!vault.name) {
      errors.push('Vault name is required')
    }

    if (!vault.publicKeys) {
      errors.push('Vault public keys are missing')
    }

    if (!vault.keyShares) {
      errors.push('Vault key shares are missing')
    }

    if (!vault.signers || vault.signers.length === 0) {
      errors.push('Vault must have at least one signer')
    }

    if (!vault.localPartyId) {
      errors.push('Local party ID is required')
    }

    // Warnings
    if (!vault.isBackedUp) {
      warnings.push('Vault is not backed up')
    }

    if (
      vault.createdAt &&
      Date.now() - vault.createdAt > 365 * 24 * 60 * 60 * 1000
    ) {
      warnings.push('Vault is older than one year')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    }
  }
}
