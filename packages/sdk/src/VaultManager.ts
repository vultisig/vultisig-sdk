import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { VaultStorage } from './runtime/storage/types'
import { ServerManager } from './server/ServerManager'
import { FastSigningService } from './services/FastSigningService'
import { KeygenMode, VaultCreationStep, VaultData, VaultType } from './types'
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
  private storage: VaultStorage

  constructor(
    private wasmManager: WASMManager,
    private serverManager: ServerManager,
    private config: VaultConfig,
    storage: VaultStorage
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
      if (vaultData?.publicKeyEcdsa === publicKey) {
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
  createVaultInstance(id: number, vaultData: VaultData): Vault {
    // Convert VaultData to CoreVault format for the Vault class
    const coreVault: CoreVault = {
      name: vaultData.name,
      publicKeys: {
        ecdsa: vaultData.publicKeyEcdsa,
        eddsa: vaultData.publicKeyEddsa,
      },
      signers: vaultData.signers.map(s => s.id),
      createdAt: vaultData.createdAt,
      hexChainCode: vaultData.hexChainCode,
      keyShares: {
        ecdsa: '', // Will be populated from vault file when needed
        eddsa: '', // Will be populated from vault file when needed
      },
      localPartyId:
        vaultData.signers.find(s => !s.id.startsWith('Server-'))?.id ||
        vaultData.signers[0].id,
      libType: 'DKLS',
      isBackedUp: vaultData.isBackedUp,
      order: vaultData.vaultIndex,
    }

    return new Vault(
      id,
      vaultData,
      coreVault,
      this.createVaultServices(),
      this.config,
      this.storage
    )
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
      onProgressInternal?: (step: VaultCreationStep, vault?: Vault) => void
    }
  ): Promise<Vault> {
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
      onProgressInternal?: (step: VaultCreationStep, vault?: Vault) => void
    }
  ): Promise<Vault> {
    if (!options?.password) {
      throw new Error('Password is required for fast vault creation')
    }
    if (!options?.email) {
      throw new Error('Email is required for fast vault creation')
    }

    const reportProgress = options?.onProgressInternal || (() => {})

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

    // Build unified VaultData
    const vaultData: VaultData = {
      id: vaultId,
      publicKeyEcdsa: result.vault.publicKeys.ecdsa,
      publicKeyEddsa: result.vault.publicKeys.eddsa,
      name: result.vault.name,
      isEncrypted: true,
      type: 'fast',
      createdAt: result.vault.createdAt || Date.now(),
      lastModified: Date.now(),
      currency: this.config.defaultCurrency || 'usd',
      chains: this.config.defaultChains?.map(c => c.toString()) || [],
      tokens: {},
      threshold: 2,
      totalSigners: 2,
      vaultIndex: 0,
      signers: result.vault.signers.map((s: string) => ({
        id: s,
        publicKey: s.startsWith('Server-') ? s : result.vault.publicKeys.ecdsa,
        name: s,
      })),
      hexChainCode: result.vault.hexChainCode,
      hexEncryptionKey: '',
      vultFileContent: vultContent,
      isBackedUp: true,
    }

    // Save to storage (single write)
    await this.storage.set(`vault:${vaultId}`, vaultData)

    // Set as active
    await this.storage.set('activeVaultId', vaultId)

    // Create Vault instance
    const vaultInstance = this.createVaultInstance(vaultId, vaultData)

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

    return vaultInstance
  }

  /**
   * Create a secure vault (multi-device)
   */
  private async createSecureVault(
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
      // 1. Parse VaultContainer from content
      const container = vaultContainerFromString(vultContent.trim())

      // 2. Handle decryption if needed
      let vaultBase64: string
      if (container.isEncrypted) {
        if (!password) {
          throw new VaultImportError(
            VaultImportErrorCode.PASSWORD_REQUIRED,
            'Password required for encrypted vault'
          )
        }

        // Decrypt
        const encryptedData = fromBase64(container.vault)
        const decryptedBuffer = await decryptWithAesGcm({
          key: password,
          value: encryptedData,
        })
        vaultBase64 = Buffer.from(decryptedBuffer).toString('base64')
      } else {
        vaultBase64 = container.vault
      }

      // 3. Parse inner Vault protobuf
      const vaultBinary = fromBase64(vaultBase64)
      const vaultProtobuf = fromBinary(VaultSchema, vaultBinary)
      const parsedVault = fromCommVault(vaultProtobuf)

      // 4. Determine vault type
      const vaultType = parsedVault.signers.some(s => s.startsWith('Server-'))
        ? 'fast'
        : 'secure'

      // 5. Check if vault already exists (by public key)
      let vaultId: number
      const existingVaultId = await this.findVaultByPublicKey(
        parsedVault.publicKeys.ecdsa
      )

      if (existingVaultId !== null) {
        // Update existing vault
        vaultId = existingVaultId
      } else {
        // New vault - get next ID
        vaultId = await this.getNextVaultId()
      }

      // 6. Build unified VaultData
      const vaultData: VaultData = {
        id: vaultId,
        publicKeyEcdsa: parsedVault.publicKeys.ecdsa,
        publicKeyEddsa: parsedVault.publicKeys.eddsa,
        name: parsedVault.name,
        isEncrypted: container.isEncrypted,
        type: vaultType,
        createdAt: parsedVault.createdAt || Date.now(),
        lastModified: Date.now(),
        currency: this.config.defaultCurrency || 'usd',
        chains: this.config.defaultChains?.map(c => c.toString()) || [],
        tokens: {},
        threshold: Object.keys(parsedVault.keyShares).length,
        totalSigners: parsedVault.signers.length,
        vaultIndex: parsedVault.order || 0,
        signers: parsedVault.signers.map(s => ({
          id: s,
          publicKey: s.startsWith('Server-') ? s : parsedVault.publicKeys.ecdsa,
          name: s,
        })),
        hexChainCode: parsedVault.hexChainCode,
        hexEncryptionKey: '', // Not available in core vault
        vultFileContent: vultContent.trim(), // Store original content!
        isBackedUp: true,
      }

      // 7. Save to storage (single write)
      await this.storage.set(`vault:${vaultId}`, vaultData)

      // 8. Set as active vault
      await this.storage.set('activeVaultId', vaultId)

      // 9. Create and return Vault instance
      return this.createVaultInstance(vaultId, vaultData)
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
      const id = parseInt(key.split(':')[1])
      const vaultData = await this.storage.get<VaultData>(key)

      if (vaultData) {
        vaults.push(this.createVaultInstance(id, vaultData))
      }
    }

    return vaults
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

    return this.createVaultInstance(id, vaultData)
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
    // Remove vault data
    await this.storage.remove(`vault:${id}`)

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
