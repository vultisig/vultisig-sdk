import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { SdkContext, VaultContext } from './context/SdkContext'
import { FastSigningService } from './services/FastSigningService'
import { VaultData } from './types'
import { FastVault } from './vault/FastVault'
import { SecureVault } from './vault/SecureVault'
import { VaultBase } from './vault/VaultBase'
import { VaultImportError, VaultImportErrorCode } from './vault/VaultError'

/**
 * VaultManager handles vault lifecycle operations
 * Manages vault storage, import/export, and active vault state
 *
 * Requires SdkContext for all dependencies (storage, config, etc.)
 */
export class VaultManager {
  private readonly context: SdkContext

  constructor(context: SdkContext) {
    this.context = context
  }

  /**
   * Get storage from context
   */
  private get storage() {
    return this.context.storage
  }

  /**
   * Initialize vault manager
   * No caching needed - storage layer handles it
   */
  async init(): Promise<void> {
    // Nothing to do! No caching.
    // Active vault ID is loaded on-demand in getActiveVault()
  }

  /**
   * Create VaultContext from SdkContext
   * Used when creating vault instances
   */
  private createVaultContext(): VaultContext {
    return {
      storage: this.context.storage,
      config: this.context.config,
      serverManager: this.context.serverManager,
      passwordCache: this.context.passwordCache,
      wasmProvider: this.context.wasmProvider,
    }
  }

  /**
   * Create Vault instance with proper service injection
   * Internal helper for consistent vault instantiation
   * Returns appropriate subclass based on vault type
   */
  createVaultInstance(vaultData: VaultData): VaultBase {
    const vaultContext = this.createVaultContext()

    // Factory pattern - return appropriate subclass based on vault type
    if (vaultData.type === 'fast') {
      const fastSigningService = new FastSigningService(this.context.serverManager, this.context.wasmProvider)
      return FastVault.fromStorage(vaultData, fastSigningService, vaultContext)
    } else {
      return SecureVault.fromStorage(vaultData, vaultContext)
    }
  }

  // ===== VAULT LIFECYCLE =====

  /**
   * Import vault from .vult file content (sets as active)
   *
   * @param vultContent - The base64-encoded .vult file content (as string)
   * @param password - Optional password for encrypted vaults
   * @returns VaultBase instance (FastVault or SecureVault depending on vault type)
   *
   * @example
   * const vultContent = fs.readFileSync('my-vault.vult', 'utf-8')
   * const vault = await vaultManager.importVault(vultContent, 'password123')
   */
  async importVault(vultContent: string, password?: string): Promise<VaultBase> {
    try {
      // Parse to check if it already exists
      const container = vaultContainerFromString(vultContent.trim())

      // We need to peek at the public key to check for duplicates
      // This requires partial parsing
      let vaultBase64: string
      if (container.isEncrypted) {
        if (!password) {
          throw new VaultImportError(VaultImportErrorCode.PASSWORD_REQUIRED, 'Password required for encrypted vault')
        }
        const encryptedData = fromBase64(container.vault)
        const decryptedBuffer = await decryptWithAesGcm({
          key: password,
          value: encryptedData,
        })
        vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
      } else {
        vaultBase64 = container.vault
      }

      const vaultBinary = fromBase64(vaultBase64)
      const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
      const parsedVault = fromCommVault(vaultProtobuf)

      // Use ECDSA public key as vault ID
      const vaultId = parsedVault.publicKeys.ecdsa

      // Determine vault type from parsed vault
      const vaultType = parsedVault.signers.some((s: string) => s.startsWith('Server-')) ? 'fast' : 'secure'

      // Create vault context from SDK context
      const vaultContext = this.createVaultContext()

      // Create vault instance using static factory methods
      // Pass parsedVault to avoid parsing encrypted content synchronously
      let vaultInstance: VaultBase
      if (vaultType === 'fast') {
        const fastSigningService = new FastSigningService(this.context.serverManager, this.context.wasmProvider)
        vaultInstance = FastVault.fromImport(vaultId, vultContent.trim(), parsedVault, fastSigningService, vaultContext)
      } else {
        vaultInstance = SecureVault.fromImport(vaultId, vultContent.trim(), parsedVault, vaultContext)
      }

      // Cache password if provided (for encrypted vaults)
      if (password && container.isEncrypted) {
        this.context.passwordCache.set(vaultId, password)
      }

      // Save to storage
      await vaultInstance.save()

      // Set as active vault
      await this.storage.set('activeVaultId', vaultId)

      return vaultInstance
    } catch (error) {
      if (error instanceof VaultImportError) {
        throw error
      }
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to import vault: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * Export vault as .vult file content
   * @param id - Vault ID (ECDSA public key)
   * @returns Base64-encoded .vult file content
   * @throws Error if vault not found
   *
   * @example
   * const vultContent = await vaultManager.exportVault('0254b580acd52b5c...')
   * fs.writeFileSync('backup.vult', vultContent)
   */
  async exportVault(id: string): Promise<string> {
    const vaultData = await this.storage.get<VaultData>(`vault:${id}`)

    if (!vaultData) {
      throw new Error(`Vault ${id} not found`)
    }

    return vaultData.vultFileContent
  }

  /**
   * List all stored vaults as VaultBase instances
   * Users can call vault methods on each instance to get data
   *
   * @returns Array of VaultBase instances (FastVault or SecureVault)
   * @example
   * ```typescript
   * const vaults = await vaultManager.listVaults()
   * vaults.forEach(vault => {
   *   console.log(`${vault.name}: ${vault.type}`)
   * })
   * ```
   */
  async listVaults(): Promise<VaultBase[]> {
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => {
      const parts = k.split(':')
      return parts.length === 2 && parts[0] === 'vault' // Only vault storage keys (not cache)
    })
    const vaults: VaultBase[] = []

    for (const key of vaultKeys) {
      const vaultData = await this.storage.get<VaultData>(key)

      if (vaultData) {
        vaults.push(this.createVaultInstance(vaultData))
      }
    }

    // Sort by order field
    return vaults.sort((a, b) => a.order - b.order)
  }

  /**
   * Get vault instance by ID
   *
   * @param id - Vault ID (ECDSA public key)
   * @returns VaultBase instance or null if not found
   * @example
   * ```typescript
   * const vault = await vaultManager.getVaultById('0254b580acd52b5c...')
   * if (vault) {
   *   const balance = await vault.balance('Bitcoin')
   * }
   * ```
   */
  async getVaultById(id: string): Promise<VaultBase | null> {
    const vaultData = await this.storage.get<VaultData>(`vault:${id}`)

    if (!vaultData) {
      return null
    }

    return this.createVaultInstance(vaultData)
  }

  /**
   * Get all vault instances
   * Async equivalent to listVaults()
   *
   * @returns Array of all vault instances
   */
  async getAllVaults(): Promise<VaultBase[]> {
    return this.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(id: string): Promise<void> {
    // Get vault instance
    const vault = await this.getVaultById(id)

    if (!vault) {
      throw new Error(`Vault ${id} not found`)
    }

    // Let vault delete itself
    await vault.delete()

    // Clear active vault if it was the deleted one
    const activeId = await this.storage.get<string>('activeVaultId')
    if (activeId === id) {
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    // Remove all vault data
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => k.startsWith('vault:'))

    for (const key of vaultKeys) {
      await this.storage.remove(key)
    }

    // Clear active vault
    await this.storage.remove('activeVaultId')
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  async setActiveVault(id: string | null): Promise<void> {
    if (id !== null) {
      await this.storage.set('activeVaultId', id)
    } else {
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<VaultBase | null> {
    const id = await this.storage.get<string>('activeVaultId')

    if (id === null || id === undefined) {
      return null
    }

    return this.getVaultById(id)
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    const id = await this.storage.get<string>('activeVaultId')
    return id !== null && id !== undefined
  }

  // ===== UTILITY METHODS =====

  /**
   * Check if .vult file content is encrypted
   * @param vultContent - The .vult file content as a string
   * @returns true if encrypted, false otherwise
   */
  async isVaultContentEncrypted(vultContent: string): Promise<boolean> {
    try {
      const container = vaultContainerFromString(vultContent.trim())
      return container.isEncrypted
    } catch (error) {
      throw new VaultImportError(
        VaultImportErrorCode.CORRUPTED_DATA,
        `Failed to check encryption status: ${(error as Error).message}`,
        error as Error
      )
    }
  }
}
