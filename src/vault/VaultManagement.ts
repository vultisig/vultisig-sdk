import { fromBinary } from '@bufbuild/protobuf'

import { fromCommVault } from '../core/mpc/types/utils/commVault'
import { VaultSchema } from '../core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '../core/ui/vault/import/utils/vaultContainerFromString'
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

  constructor(
    private wasmManager?: WASMManager,
    private sdkInstance?: any
  ) {}

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
    // TODO: Implement vault creation with MPC keygen
    throw new Error(
      'createVault() not implemented yet - requires MPC keygen integration'
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
      const vaultInstance = new VaultClass(
        vault,
        await this.wasmManager?.getWalletCore(),
        this.wasmManager,
        this.sdkInstance
      )
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
        currency: this.sdkInstance?.getDefaultCurrency?.() || 'USD',
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

    // Clear active vault if it was the deleted one
    if (this.activeVault?.data.publicKeys.ecdsa === vaultId) {
      this.activeVault = null
    }
  }

  /**
   * Clear all stored vaults
   */
  async clearVaults(): Promise<void> {
    this.vaults.clear()
    this.activeVault = null
  }

  // ===== ACTIVE VAULT MANAGEMENT =====

  /**
   * Switch to different vault
   */
  setActiveVault(vault: VaultClass): void {
    this.activeVault = vault
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
