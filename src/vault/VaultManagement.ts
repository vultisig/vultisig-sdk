import { create, fromBinary, toBinary } from '@bufbuild/protobuf'

import { fromCommVault, toCommVault } from '../core/mpc/types/utils/commVault'
import { VaultContainerSchema } from '../core/mpc/types/vultisig/vault/v1/vault_container_pb'
import { VaultSchema } from '../core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '../core/ui/vault/import/utils/vaultContainerFromString'
import { base64Encode } from '../lib/utils/base64Encode'
import { decryptWithAesGcm } from '../lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '../lib/utils/fromBase64'
import type {
  KeygenMode,
  Summary,
  Vault,
  VaultCreationStep,
  VaultType,
} from '../types'
import type { WASMManager } from '../wasm'
import { StorageManager, type StoredVault } from './StorageManager'
import { Vault as VaultClass } from './Vault'
import { VaultImportError, VaultImportErrorCode } from './VaultError'

/**
 * Determine vault type based on signer names
 * Fast vaults have one signer that starts with "Server-"
 * Secure vaults have only device signers (no "Server-" prefix)
 */
function determineVaultType(signers: string[]): 'fast' | 'secure' {
  return signers.some(signer => signer.startsWith('Server-'))
    ? 'fast'
    : 'secure'
}

/**
 * VaultManagement handles vault lifecycle operations
 * Manages vault storage, import/export, and active vault state
 */
export class VaultManagement {
  private vaults = new Map<string, Vault>()
  private activeVault: VaultClass | null = null
  private storageManager: StorageManager
  private storageLoaded = false

  constructor(
    private wasmManager?: WASMManager,
    private sdkInstance?: any
  ) {
    this.storageManager = new StorageManager()
  }

  // ===== STORAGE INTEGRATION =====

  /**
   * Load vaults from storage (called lazily on first vault operation)
   */
  private async loadVaultsFromStorage(): Promise<void> {
    if (this.storageLoaded) return

    try {
      const storedVaults = await this.storageManager.getVaults()
      const corruptedVaultIds: string[] = []

      for (const storedVault of storedVaults) {
        if (!storedVault.containerBase64) {
          console.warn(
            `Vault ${storedVault.name} has no data - skipping. Please re-import this vault.`
          )
          corruptedVaultIds.push(storedVault.id)
          continue
        }

        try {
          // Deserialize the stored vault container (stored as base64 protobuf)
          const containerBinary = fromBase64(storedVault.containerBase64)
          const container = fromBinary(VaultContainerSchema, containerBinary)
          
          // Extract and deserialize the vault protobuf
          const vaultBinary = fromBase64(container.vault)
          const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
          const vault = fromCommVault(vaultProtobuf)

          // Store in vaults Map
          this.vaults.set(vault.publicKeys.ecdsa, vault)
        } catch (error) {
          console.warn(
            `Failed to load vault ${storedVault.name}:`,
            error,
            '\nThis vault may be corrupted and needs to be re-imported.'
          )
          corruptedVaultIds.push(storedVault.id)
        }
      }

      // Clean up corrupted vaults from storage
      if (corruptedVaultIds.length > 0) {
        for (const id of corruptedVaultIds) {
          try {
            await this.storageManager.deleteVault(id)
          } catch (error) {
            console.warn(`Failed to delete corrupted vault ${id}:`, error)
          }
        }
      }

      // Restore active vault if set
      const activeId = await this.storageManager.getCurrentVaultId()
      if (activeId && this.vaults.has(activeId)) {
        const vaultData = this.vaults.get(activeId)!
        this.activeVault = new VaultClass(
          vaultData,
          await this.wasmManager?.getWalletCore(),
          this.wasmManager,
          this.sdkInstance
        )
      }

      this.storageLoaded = true
    } catch (error) {
      console.warn('Failed to load vaults from storage:', error)
      this.storageLoaded = true
    }
  }

  /**
   * Serialize vault to storage format (creates VaultContainer)
   * Note: Vaults are always stored UNENCRYPTED in localStorage for performance.
   * Encryption is only used for .vult file exports.
   */
  private serializeVaultForStorage(
    vault: Vault,
    wasOriginallyEncrypted: boolean
  ): StoredVault {
    // Convert vault to protobuf
    const commVault = toCommVault(vault)
    const vaultData = toBinary(VaultSchema, commVault)

    // Create VaultContainer (always unencrypted for storage)
    const vaultContainer = create(VaultContainerSchema, {
      version: BigInt(1),
      vault: Buffer.from(vaultData).toString('base64'),
      isEncrypted: false, // Always store unencrypted in localStorage
    })

    // Serialize container to base64
    const vaultContainerData = toBinary(VaultContainerSchema, vaultContainer)
    const containerBase64 = Buffer.from(vaultContainerData).toString('base64')

    const storedVault = {
      id: vault.publicKeys.ecdsa,
      name: `${vault.name}.vult`,
      size: containerBase64.length,
      encrypted: wasOriginallyEncrypted, // Track original encryption status for UI
      dateAdded: Date.now(),
      containerBase64,
    }

    return storedVault
  }

  // ===== VAULT LIFECYCLE =====

  /**
   * Create new vault (auto-initializes SDK, sets as active)
   */
  async createVault(
    name: string,
    options?: {
      type?: VaultType
      keygenMode?: KeygenMode
      password?: string
      email?: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<VaultClass> {
    const vaultType = options?.type ?? 'fast'

    if (vaultType === 'fast') {
      return this.createFastVault(name, options)
    } else {
      return this.createSecureVault(name, options)
    }
  }

  /**
   * Create a fast vault (2-of-2 with VultiServer)
   */
  private async createFastVault(
    name: string,
    options?: {
      password?: string
      email?: string
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<VaultClass> {
    if (!options?.password) {
      throw new Error('Password is required for fast vault creation')
    }
    if (!options?.email) {
      throw new Error('Email is required for fast vault creation')
    }

    // Ensure WASM is initialized
    if (!this.wasmManager) {
      throw new Error('WASMManager not available')
    }
    await this.wasmManager.initialize()

    // Use ServerManager to create the fast vault
    const serverManager = this.sdkInstance?.getServerManager()
    if (!serverManager) {
      throw new Error('ServerManager not available')
    }

    const result = await serverManager.createFastVault({
      name,
      password: options.password,
      email: options.email,
      onProgress: options.onProgress
        ? update => {
            options.onProgress!({
              step: update.phase === 'complete' ? 'complete' : 'keygen',
              progress: update.phase === 'complete' ? 100 : 50,
              message: update.message,
            })
          }
        : undefined,
    })

    // Create VaultClass instance from the created vault
    const vaultInstance = new VaultClass(
      result.vault,
      await this.wasmManager.getWalletCore(),
      this.wasmManager,
      this.sdkInstance
    )

    // Store the vault
    this.vaults.set(result.vault.publicKeys.ecdsa, result.vault)

    // Set as active vault
    this.activeVault = vaultInstance

    // Persist to storage
    try {
      const storedVault = this.serializeVaultForStorage(result.vault, false)
      await this.storageManager.saveVault(storedVault)
      await this.storageManager.setCurrentVaultId(result.vault.publicKeys.ecdsa)
    } catch (error) {
      console.warn('Failed to persist vault to storage:', error)
    }

    // Mark storage as loaded since we just added a vault
    this.storageLoaded = true

    return vaultInstance
  }

  /**
   * Create a secure vault (multi-device)
   */
  private async createSecureVault(
    _name: string,
    _options?: {
      keygenMode?: KeygenMode
      onProgress?: (step: VaultCreationStep) => void
    }
  ): Promise<VaultClass> {
    // TODO: Implement secure vault creation with multi-device MPC keygen
    throw new Error(
      'Secure vault creation not implemented yet - requires multi-device MPC keygen integration'
    )
  }

  /**
   * Import vault from base64 container data (for loading from storage)
   * Note: Storage vaults are always unencrypted, no password needed.
   */
  async addVaultFromBase64(
    containerBase64: string,
    name: string
  ): Promise<VaultClass> {
    try {
      // Parse VaultContainer protobuf from base64
      const containerBinary = fromBase64(containerBase64)
      const container = fromBinary(VaultContainerSchema, containerBinary)

      // Storage vaults are always unencrypted (for performance)
      // The encryption flag in storage metadata is just for UI display
      const vaultBase64 = container.vault

      // Decode and parse the inner Vault protobuf
      const vaultBinary = fromBase64(vaultBase64)
      const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)

      // Convert to Vault object
      const vault = fromCommVault(vaultProtobuf)

      // Determine security type
      const securityType = determineVaultType(vault.signers)

      // Apply global settings and normalize
      const normalizedVault = this.applyGlobalSettings(
        vault,
        false, // Not encrypted in storage
        securityType
      )

      // Store the vault
      this.vaults.set(normalizedVault.publicKeys.ecdsa, normalizedVault)

      // Create VaultClass instance
      const vaultInstance = new VaultClass(
        normalizedVault,
        await this.wasmManager?.getWalletCore(),
        this.wasmManager,
        this.sdkInstance
      )

      // Cache encryption status (false for storage vaults)
      vaultInstance.setCachedEncryptionStatus(false)

      // No need to re-persist since we just loaded from storage
      // Set as active vault and mark storage as loaded
      this.setActiveVault(vaultInstance)
      this.storageLoaded = true

      return vaultInstance
    } catch (error) {
      if (error instanceof VaultImportError) {
        throw error
      }
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to import vault from storage: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Import vault from file (sets as active)
   */
  async addVault(file: File, password?: string): Promise<VaultClass> {
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

      // Determine encryption status and security type (cache these to avoid repeated decoding)
      const isEncrypted = container.isEncrypted
      const securityType = determineVaultType(vault.signers)

      // Apply global settings and normalize
      const normalizedVault = this.applyGlobalSettings(
        vault,
        isEncrypted,
        securityType
      )

      // Store the vault
      this.vaults.set(normalizedVault.publicKeys.ecdsa, normalizedVault)

      // Create VaultClass instance
      const vaultInstance = new VaultClass(
        normalizedVault,
        await this.wasmManager?.getWalletCore(),
        this.wasmManager,
        this.sdkInstance
      )

      // Set cached properties on the Vault instance
      vaultInstance.setCachedEncryptionStatus(isEncrypted)
      vaultInstance.setCachedSecurityType(securityType)

      // Set as active vault
      this.activeVault = vaultInstance

      // Persist to storage
      try {
        const storedVault = this.serializeVaultForStorage(
          normalizedVault,
          isEncrypted
        )
        await this.storageManager.saveVault(storedVault)
        await this.storageManager.setCurrentVaultId(
          normalizedVault.publicKeys.ecdsa
        )
      } catch (error) {
        console.warn('Failed to persist vault to storage:', error)
      }

      // Mark storage as loaded since we just added a vault
      this.storageLoaded = true

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
   * List all stored vaults
   */
  async listVaults(): Promise<Summary[]> {
    // Load vaults from storage if not already loaded
    await this.loadVaultsFromStorage()

    const summaries: Summary[] = []

    for (const [, vault] of this.vaults) {
      const vaultInstance = new VaultClass(
        vault,
        await this.wasmManager?.getWalletCore(),
        this.wasmManager,
        this.sdkInstance
      )
      const summary = vaultInstance.summary()

      // Get stored vault metadata for size
      const storedVault = await this.storageManager.getVault(
        vault.publicKeys.ecdsa
      )

      const fullSummary: Summary = {
        id: summary.id,
        name: summary.name,
        type: summary.type as VaultType,
        chains: summary.chains,
        createdAt: summary.createdAt ?? Date.now(),
        isBackedUp: () => vault.isBackedUp ?? false,
        isEncrypted: vaultInstance.getCachedEncryptionStatus() ?? false,
        lastModified: vault.createdAt ?? Date.now(),
        size: storedVault?.size ?? 0,
        threshold:
          vault.threshold ?? this.calculateThreshold(vault.signers.length),
        totalSigners: vault.signers.length,
        vaultIndex: vault.localPartyId ? parseInt(vault.localPartyId) : 0,
        signers: vault.signers.map((signerId, index) => ({
          id: signerId,
          publicKey: '', // TODO: Map signer ID to public key if available
          name: `Signer ${index + 1}`,
        })),
        keys: {
          ecdsa: vault.publicKeys.ecdsa,
          eddsa: vault.publicKeys.eddsa,
          hexChainCode: vault.hexChainCode,
          hexEncryptionKey: '', // TODO: Add encryption key if available
        },
        currency: this.sdkInstance?.getDefaultCurrency?.() || 'USD',
        tokens: {}, // TODO: Implement token management
      }

      summaries.push(fullSummary)
    }

    return summaries
  }

  /**
   * Update vault in storage (called after modifications like rename)
   */
  async updateVaultInStorage(vault: VaultClass): Promise<void> {
    const vaultData = vault.data
    const isEncrypted = vault.getCachedEncryptionStatus() ?? false
    const vaultId = vaultData.publicKeys.ecdsa

    // Update in-memory Map
    this.vaults.set(vaultId, vaultData)

    // Persist to storage
    try {
      const storedVault = this.serializeVaultForStorage(vaultData, isEncrypted)
      await this.storageManager.saveVault(storedVault)
    } catch (error) {
      console.warn('Failed to update vault in storage:', error)
    }
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultClass): Promise<void> {
    const vaultId = vault.data.publicKeys.ecdsa
    this.vaults.delete(vaultId)

    // Clear active vault if it was the deleted one
    if (this.activeVault?.data.publicKeys.ecdsa === vaultId) {
      this.activeVault = null
    }

    // Remove from storage
    try {
      await this.storageManager.deleteVault(vaultId)
    } catch (error) {
      console.warn('Failed to delete vault from storage:', error)
    }
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    this.vaults.clear()
    this.activeVault = null
    this.storageLoaded = false

    // Clear storage
    try {
      await this.storageManager.clearVaults()
    } catch (error) {
      console.warn('Failed to clear vaults from storage:', error)
    }
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  setActiveVault(vault: VaultClass): void {
    this.activeVault = vault

    // Persist active vault ID (fire and forget)
    this.storageManager
      .setCurrentVaultId(vault.data.publicKeys.ecdsa)
      .catch(error => {
        console.warn('Failed to persist active vault ID:', error)
      })
  }

  /**
   * Get current active vault
   */
  getActiveVault(): VaultClass | null {
    return this.activeVault
  }

  /**
   * Check if there's an active vault
   */
  hasActiveVault(): boolean {
    return this.activeVault !== null
  }

  /**
   * Get direct access to storage manager (for advanced use cases)
   */
  getStorageManager(): StorageManager {
    return this.storageManager
  }

  // ===== FILE OPERATIONS =====

  /**
   * Check if .vult file is encrypted
   */
  async isVaultFileEncrypted(file: File): Promise<boolean> {
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

  // ===== PRIVATE HELPER METHODS =====

  /**
   * Read file as ArrayBuffer (works in both browser and Node.js)
   */
  private async readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
    // Check if we're in a browser environment
    if (typeof globalThis !== 'undefined' && 'FileReader' in globalThis) {
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

  /**
   * Apply global VaultManager settings to an imported vault
   */
  private applyGlobalSettings(
    vault: Vault,
    isEncrypted: boolean,
    securityType: 'fast' | 'secure'
  ): Vault {
    // Calculate and store threshold based on signers count
    const threshold = this.calculateThreshold(vault.signers.length)

    return {
      ...vault,
      threshold,
      isBackedUp: true, // Imported vaults are considered backed up
      // Store cached properties that will be used by Vault class
      _cachedEncryptionStatus: isEncrypted,
      _cachedSecurityType: securityType,
    } as Vault & {
      _cachedEncryptionStatus: boolean
      _cachedSecurityType: 'fast' | 'secure'
    }
  }

  /**
   * Calculate threshold based on total signers
   */
  private calculateThreshold(totalSigners: number): number {
    // For 2-of-2 (fast vaults), threshold is 2
    // For multi-sig (secure vaults), threshold is typically (n+1)/2
    return totalSigners === 2 ? 2 : Math.ceil((totalSigners + 1) / 2)
  }
}
