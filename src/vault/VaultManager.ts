import { fromBinary } from '@bufbuild/protobuf'
import { fromCommVault } from '@core/mpc/types/utils/commVault'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { vaultContainerFromString } from '@core/ui/vault/import/utils/vaultContainerFromString'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBase64 } from '@lib/utils/fromBase64'

import { VaultImportError, VaultImportErrorCode } from './VaultError'

import type {
  Vault,
  VaultDetails,
  VaultValidationResult,
} from '../types'

/**
 * VaultManager handles all vault operations by wrapping existing core functionality
 */
export class VaultManager {
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

    throw new Error('Unable to read file: FileReader not available and no internal buffer found')
  }

  /**
   * Add a vault from a .vult file to the VaultManager
   * Automatically applies global settings (chains, currency) to the imported vault
   * @param file - The .vult file to import
   * @param password - Optional password for encrypted vaults
   * @returns Promise<Vault> - The imported and normalized vault
   */
  static async add(file: File, password?: string): Promise<Vault> {
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

      // Apply global settings and normalize
      const normalizedVault = this.applyGlobalSettings(vault)

      return normalizedVault
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
   * Apply global VaultManager settings to an imported vault
   * @param vault - The vault to normalize
   * @returns Vault - The vault with global settings applied
   */
  private static applyGlobalSettings(vault: Vault): Vault {
    // Calculate and store threshold based on signers count
    const threshold = this.calculateThreshold(vault.signers.length)

    return {
      ...vault,
      threshold,
      isBackedUp: true, // Imported vaults are considered backed up
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
   * Normalize vault object to ensure consistent structure
   * @param v - Raw vault object to normalize
   * @returns Normalized vault object
   */
  private normalizeVault(v: Vault): Vault {
    return {
      name: v.name,
      publicKeys: v.publicKeys,
      signers: v.signers,
      createdAt: v.createdAt ?? Date.now(),
      hexChainCode: v.hexChainCode,
      keyShares: v.keyShares ?? { ecdsa: '', eddsa: '' },
      localPartyId: v.localPartyId,
      resharePrefix: (v as any).resharePrefix,
      libType: v.libType ?? 'DKLS',
      threshold: v.threshold ?? VaultManager.calculateThreshold(v.signers.length), // Calculate if not present
      isBackedUp: v.isBackedUp ?? true, // Default to true for imported vaults
      order: v.order ?? 0,
      folderId: (v as any).folderId,
      lastPasswordVerificationTime: (v as any).lastPasswordVerificationTime,
    }
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
  getVaultDetails(vault: Vault): VaultDetails {
    // Determine security type based on signers count
    const securityType: 'fast' | 'secure' =
      vault.signers.length === 2 ? 'fast' : 'secure'

    return {
      name: vault.name,
      id: vault.publicKeys.ecdsa || 'unknown',
      securityType,
      threshold: vault.threshold ?? VaultManager.calculateThreshold(vault.signers.length), // Fallback for legacy vaults
      participants: vault.signers.length,
      chains: [], // Will be derived from public keys - requires chain integration
      createdAt: vault.createdAt,
      isBackedUp: vault.isBackedUp,
    }
  }

  /**
   * Validate vault structure and integrity
   */
  validateVault(vault: Vault): VaultValidationResult {
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
