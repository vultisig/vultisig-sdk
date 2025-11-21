import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { Storage } from './runtime/storage/types'
import { ServerManager } from './server/ServerManager'
import { FastSigningService } from './services/FastSigningService'
import { KeygenMode, VaultCreationStep, VaultData } from './types'
import { createVaultBackup } from './utils/export'
import { Vault } from './vault/Vault'
import { VaultImportError, VaultImportErrorCode } from './vault/VaultError'
import { VaultConfig, VaultServices } from './vault/VaultServices'
import { WASMManager } from './wasm'

/**
 * VaultManager handles vault lifecycle operations
 * Manages vault storage, import/export, and active vault state
 */
export class VaultManager {
  private storage: Storage

  constructor(
    private wasmManager: WASMManager,
    private serverManager: ServerManager,
    private config: VaultConfig,
    storage: Storage
  ) {
    this.storage = storage
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
   * Get next available vault ID by scanning existing vaults
   * Returns 0 if no vaults exist, otherwise max(existing IDs) + 1
   */
  private async getNextVaultId(): Promise<number> {
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => /^vault:\d+$/.test(k))

    if (vaultKeys.length === 0) {
      return 0
    }

    const ids = vaultKeys.map(k => parseInt(k.split(':')[1]))
    return Math.max(...ids) + 1
  }

  /**
   * Find vault ID by public key (for detecting re-imports)
   */
  private async findVaultByPublicKey(
    publicKey: string
  ): Promise<number | null> {
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => /^vault:\d+$/.test(k))

    for (const key of vaultKeys) {
      const vaultData = await this.storage.get<VaultData>(key)
      if (vaultData?.publicKeys?.ecdsa === publicKey) {
        return vaultData.id
      }
    }

    return null
  }

  /**
   * Create VaultServices instance for dependency injection
   * Simplified - only essential services needed
   */
  private createVaultServices(): VaultServices {
    return {
      wasmManager: this.wasmManager,
      fastSigningService: new FastSigningService(
        this.serverManager,
        this.wasmManager
      ),
    }
  }

  /**
   * Create Vault instance with proper service injection
   * Internal helper for consistent vault instantiation
   */
  createVaultInstance(vaultData: VaultData): Vault {
    // Use static factory method for loading from storage
    return Vault.fromStorage(
      vaultData,
      this.createVaultServices(),
      this.config,
      this.storage
    )
  }

  // ===== VAULT LIFECYCLE =====

  /**
   * Create a fast vault (2-of-2 with VultiServer)
   * Fast vaults ALWAYS require both password and email
   * Returns vault instance and vaultId string for email verification
   *
   * @param name - Vault name
   * @param options.password - Vault password for encryption
   * @param options.email - Email for verification code delivery
   * @param options.onProgressInternal - Optional progress callback
   * @returns Vault instance, vaultId for verification, and verificationRequired flag
   */
  async createFastVault(
    name: string,
    options: {
      password: string
      email: string
      onProgressInternal?: (step: VaultCreationStep, vault?: Vault) => void
    }
  ): Promise<{ vault: Vault; vaultId: string; verificationRequired: true }> {
    // Password and email are required (enforced by type system)
    const reportProgress = options.onProgressInternal || (() => {})

    // Step 1: Initializing (vault not created yet)
    reportProgress(
      {
        step: 'initializing',
        progress: 0,
        message: 'Initializing vault creation...',
      },
      undefined
    )

    // Get next vault ID
    const vaultId = await this.getNextVaultId()

    // Step 2: Keygen (MPC key generation) - vault not created yet
    const result = await this.serverManager.createFastVault({
      name,
      password: options.password,
      email: options.email,
      onProgress: options.onProgressInternal
        ? update => {
            if (update.phase === 'ecdsa') {
              reportProgress(
                {
                  step: 'keygen',
                  progress: 25,
                  message: update.message || 'Generating ECDSA keys...',
                },
                undefined
              )
            } else if (update.phase === 'eddsa') {
              reportProgress(
                {
                  step: 'keygen',
                  progress: 50,
                  message: update.message || 'Generating EdDSA keys...',
                },
                undefined
              )
            } else if (update.phase === 'complete') {
              reportProgress(
                {
                  step: 'keygen',
                  progress: 60,
                  message: 'Key generation complete',
                },
                undefined
              )
            }
          }
        : undefined,
    })

    // Generate .vult file content
    const vultContent = await createVaultBackup(result.vault, options.password)

    // Create vault instance using constructor (it creates VaultData internally)
    // Pass result.vault as parsedVaultData to avoid parsing encrypted content synchronously
    const vaultInstance = new Vault(
      vaultId,
      result.vault.name,
      vultContent,
      options.password,
      this.createVaultServices(),
      this.config,
      this.storage,
      result.vault // Pre-parsed vault data from server
    )

    // Save to storage (vault creates VaultData internally and saves it)
    await vaultInstance.save()

    // Set as active
    await this.storage.set('activeVaultId', vaultId)

    // Step 3: Deriving addresses (vault now available)
    reportProgress(
      {
        step: 'deriving_addresses',
        progress: 70,
        message: 'Deriving addresses for default chains...',
      },
      vaultInstance
    )

    // Step 4: Fetching balances (vault available)
    reportProgress(
      {
        step: 'fetching_balances',
        progress: 85,
        message: 'Preparing balance tracking...',
      },
      vaultInstance
    )

    // Step 5: Applying tokens (vault available)
    reportProgress(
      {
        step: 'applying_tokens',
        progress: 90,
        message: 'Setting up default tokens...',
      },
      vaultInstance
    )

    // Step 6: Complete (vault available)
    reportProgress(
      {
        step: 'complete',
        progress: 100,
        message: 'Vault created successfully',
      },
      vaultInstance
    )

    return {
      vault: vaultInstance,
      vaultId: result.vaultId,
      verificationRequired: true,
    }
  }

  /**
   * Create a secure vault (multi-device MPC)
   * Secure vaults use threshold signing across multiple devices
   *
   * @param name - Vault name
   * @param options.keygenMode - Keygen mode configuration
   * @param options.onProgressInternal - Optional progress callback
   * @returns Vault instance
   * @throws Error - Not yet implemented
   */
  async createSecureVault(
    _name: string,
    _options?: {
      keygenMode?: KeygenMode
      onProgressInternal?: (step: VaultCreationStep, vault?: Vault) => void
    }
  ): Promise<Vault> {
    // TODO: Implement secure vault creation with multi-device MPC keygen
    throw new Error(
      'Secure vault creation not implemented yet - requires multi-device MPC keygen integration'
    )
  }

  /**
   * Import vault from .vult file content (sets as active)
   *
   * @param vultContent - The base64-encoded .vult file content (as string)
   * @param password - Optional password for encrypted vaults
   * @returns Vault instance
   *
   * @example
   * const vultContent = fs.readFileSync('my-vault.vult', 'utf-8')
   * const vault = await vaultManager.importVault(vultContent, 'password123')
   */
  async importVault(vultContent: string, password?: string): Promise<Vault> {
    try {
      // Parse to check if it already exists
      const container = vaultContainerFromString(vultContent.trim())

      // We need to peek at the public key to check for duplicates
      // This requires partial parsing
      let vaultBase64: string
      if (container.isEncrypted) {
        if (!password) {
          throw new VaultImportError(
            VaultImportErrorCode.PASSWORD_REQUIRED,
            'Password required for encrypted vault'
          )
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

      // Check if vault already exists
      let vaultId: number
      const existingVaultId = await this.findVaultByPublicKey(
        parsedVault.publicKeys.ecdsa
      )

      if (existingVaultId !== null) {
        vaultId = existingVaultId
      } else {
        vaultId = await this.getNextVaultId()
      }

      // Create vault instance using new constructor
      // Pass parsedVault to avoid parsing encrypted content synchronously
      const vaultInstance = new Vault(
        vaultId,
        parsedVault.name,
        vultContent.trim(),
        password,
        this.createVaultServices(),
        this.config,
        this.storage,
        parsedVault // Pre-parsed vault data
      )

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
   * @param id - Vault ID (numeric)
   * @returns Base64-encoded .vult file content
   * @throws Error if vault not found
   *
   * @example
   * const vultContent = await vaultManager.exportVault(0)
   * fs.writeFileSync('backup.vult', vultContent)
   */
  async exportVault(id: number): Promise<string> {
    const vaultData = await this.storage.get<VaultData>(`vault:${id}`)

    if (!vaultData) {
      throw new Error(`Vault ${id} not found`)
    }

    return vaultData.vultFileContent
  }

  /**
   * List all stored vaults as Vault instances
   * Users can call vault.summary() on each instance to get summary data
   *
   * @returns Array of Vault class instances
   * @example
   * ```typescript
   * const vaults = await vaultManager.listVaults()
   * vaults.forEach(vault => {
   *   const summary = vault.summary()
   *   console.log(`${summary.name}: ${summary.chains.join(', ')}`)
   * })
   * ```
   */
  async listVaults(): Promise<Vault[]> {
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(k => /^vault:\d+$/.test(k))
    const vaults: Vault[] = []

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
   * @param id - Numeric vault ID
   * @returns Vault instance or null if not found
   * @example
   * ```typescript
   * const vault = await vaultManager.getVaultById(0)
   * if (vault) {
   *   const balance = await vault.balance('Bitcoin')
   * }
   * ```
   */
  async getVaultById(id: number): Promise<Vault | null> {
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
  async getAllVaults(): Promise<Vault[]> {
    return this.listVaults()
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(id: number): Promise<void> {
    // Get vault instance
    const vault = await this.getVaultById(id)

    if (!vault) {
      throw new Error(`Vault ${id} not found`)
    }

    // Let vault delete itself
    await vault.delete()

    // Clear active vault if it was the deleted one
    const activeId = await this.storage.get<number>('activeVaultId')
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
    const vaultKeys = keys.filter(k => /^vault:\d+$/.test(k))

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
  async setActiveVault(id: number | null): Promise<void> {
    if (id !== null) {
      await this.storage.set('activeVaultId', id)
    } else {
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Get current active vault
   */
  async getActiveVault(): Promise<Vault | null> {
    const id = await this.storage.get<number>('activeVaultId')

    if (id === null || id === undefined) {
      return null
    }

    return this.getVaultById(id)
  }

  /**
   * Check if there's an active vault
   */
  async hasActiveVault(): Promise<boolean> {
    const id = await this.storage.get<number>('activeVaultId')
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
