import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/mpc/vault/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import type { VaultStorage } from './runtime/storage/types'
import { ServerManager } from './server/ServerManager'
import { FastSigningService } from './services/FastSigningService'
import {
  KeygenMode,
  Summary,
  Vault,
  VaultCreationStep,
  VaultType,
} from './types'
import { Vault as VaultClass } from './vault/Vault'
import { VaultImportError, VaultImportErrorCode } from './vault/VaultError'
import { VaultConfig, VaultServices } from './vault/VaultServices'
import { WASMManager } from './wasm'

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
 * VaultManager handles vault lifecycle operations
 * Manages vault storage, import/export, and active vault state
 */
export class VaultManager {
  private vaults = new Map<string, Vault>()
  private activeVault: VaultClass | null = null
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
   * Initialize vault manager by loading vault summaries from storage
   */
  async init(): Promise<void> {
    // Load all vault summaries from storage
    const keys = await this.storage.list()
    const summaryKeys = keys.filter(k => k.startsWith('vault:summary:'))

    for (const key of summaryKeys) {
      const summary = await this.storage.get<Summary>(key)
      if (summary) {
        // Note: We only store summaries, not full vault data
        // Vaults must be re-imported from .vult files on startup
        // This is intentional to keep storage minimal
      }
    }

    // Load and restore active vault ID
    const activeVaultId = await this.storage.get<string>('activeVaultId')
    if (activeVaultId) {
      // Active vault will be set when user re-imports or when vault is loaded
      // We store the ID but don't auto-load vaults (user must import .vult file)
    }
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
   * Create VaultClass instance with proper service injection
   * Internal helper for consistent vault instantiation
   */
  createVaultInstance(vaultData: Vault): VaultClass {
    return new VaultClass(
      vaultData,
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
      onProgressInternal?: (step: VaultCreationStep, vault?: VaultClass) => void
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
      onProgressInternal?: (step: VaultCreationStep, vault?: VaultClass) => void
    }
  ): Promise<VaultClass> {
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

    // Create VaultClass instance from the created vault
    const vaultInstance = this.createVaultInstance(result.vault)

    // Store the vault
    this.vaults.set(result.vault.publicKeys.ecdsa, result.vault)

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

    // Persist vault summary to storage
    const summary = vaultInstance.summary()
    await this.storage.set(`vault:summary:${summary.id}`, summary)

    // Set as active vault
    this.activeVault = vaultInstance
    await this.storage.set('activeVaultId', result.vault.publicKeys.ecdsa)

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
      onProgressInternal?: (step: VaultCreationStep, vault?: VaultClass) => void
    }
  ): Promise<VaultClass> {
    // TODO: Implement secure vault creation with multi-device MPC keygen
    throw new Error(
      'Secure vault creation not implemented yet - requires multi-device MPC keygen integration'
    )
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
      const vaultInstance = this.createVaultInstance(normalizedVault)

      // Set cached properties on the Vault instance
      vaultInstance.setCachedEncryptionStatus(isEncrypted)
      vaultInstance.setCachedSecurityType(securityType)

      // Persist vault summary to storage
      const summary = vaultInstance.summary()
      await this.storage.set(`vault:summary:${summary.id}`, summary)

      // Set as active vault
      this.activeVault = vaultInstance
      await this.storage.set('activeVaultId', normalizedVault.publicKeys.ecdsa)

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
    const summaries: Summary[] = []

    for (const [, vault] of this.vaults) {
      const vaultInstance = this.createVaultInstance(vault)
      const summary = vaultInstance.summary()

      const fullSummary: Summary = {
        id: summary.id,
        name: summary.name,
        type: summary.type as VaultType,
        chains: summary.chains,
        createdAt: summary.createdAt ?? Date.now(),
        isBackedUp: () => vault.isBackedUp ?? false,
        isEncrypted: vaultInstance.getCachedEncryptionStatus() ?? false,
        lastModified: vault.createdAt ?? Date.now(),
        size: 0, // TODO: Calculate vault size
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
        currency: this.config.defaultCurrency || 'USD',
        tokens: {}, // TODO: Implement token management
      }

      summaries.push(fullSummary)
    }

    return summaries
  }

  /**
   * Delete vault from storage (clears active if needed)
   */
  async deleteVault(vault: VaultClass): Promise<void> {
    const vaultId = vault.data.publicKeys.ecdsa
    this.vaults.delete(vaultId)

    // Remove from storage
    await this.storage.remove(`vault:summary:${vaultId}`)
    await this.storage.remove(`vault:preferences:${vaultId}`)

    // Clear active vault if it was the deleted one
    if (this.activeVault?.data.publicKeys.ecdsa === vaultId) {
      this.activeVault = null
      await this.storage.remove('activeVaultId')
    }
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    // Remove all vault-related storage keys
    const keys = await this.storage.list()
    const vaultKeys = keys.filter(
      k => k.startsWith('vault:summary:') || k.startsWith('vault:preferences:')
    )

    for (const key of vaultKeys) {
      await this.storage.remove(key)
    }

    await this.storage.remove('activeVaultId')

    this.vaults.clear()
    this.activeVault = null
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  async setActiveVault(vault: VaultClass | null): Promise<void> {
    this.activeVault = vault

    if (vault) {
      const vaultId = vault.data.publicKeys.ecdsa
      await this.storage.set('activeVaultId', vaultId)
    } else {
      await this.storage.remove('activeVaultId')
    }
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
