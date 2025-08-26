import type { 
  Vault,
  VaultOptions,
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
  ExportOptions,
  VaultSecurityType,
  ChainKind
} from '../types'

import { 
  encryptVaultKeyShares,
  decryptVaultKeyShares
} from '@core/ui/passcodeEncryption/core/vaultKeyShares'
import { vaultBackupResultFromFileContent } from '@core/ui/vault/import/utils/vaultBackupResultFromString'
import { vaultContainerFromString } from '@core/ui/vault/import/utils/vaultContainerFromString'
import { fromBase64 } from '@lib/utils/fromBase64'
import { decryptWithAesGcm } from '@lib/utils/encryption/aesGcm/decryptWithAesGcm'
import { fromBinary } from '@bufbuild/protobuf'
import { VaultSchema } from '@core/mpc/types/vultisig/vault/v1/vault_pb'
import { fromCommVault } from '@core/mpc/types/utils/commVault'

/**
 * VaultManager handles all vault operations by wrapping existing core functionality
 */
export class VaultManager {
  
  /**
   * Create a new vault (placeholder - will integrate with MPC keygen)
   */
  async createVault(options: VaultOptions): Promise<Vault> {
    // This will be implemented to integrate with MPC keygen process
    throw new Error('createVault not implemented yet - requires MPC keygen integration')
  }

  /**
   * Check if vault keyshares are encrypted with a passcode
   */
  isVaultEncrypted(vault: Vault): boolean {
    // Check if keyshares are encrypted (existing logic from core)
    return vault.keyShares && typeof vault.keyShares === 'string'
  }

  /**
   * Encrypt vault keyshares with passcode
   */
  async encryptVault(vault: Vault, passcode: string): Promise<Vault> {
    if (this.isVaultEncrypted(vault)) {
      return vault // Already encrypted
    }

    const encryptedKeyShares = await encryptVaultKeyShares(vault.keyShares, passcode)
    
    return {
      ...vault,
      keyShares: encryptedKeyShares
    }
  }

  /**
   * Decrypt vault keyshares with passcode
   */
  async decryptVault(vault: Vault, passcode: string): Promise<Vault> {
    if (!this.isVaultEncrypted(vault)) {
      return vault // Already decrypted
    }

    try {
      const decryptedKeyShares = await decryptVaultKeyShares(vault.keyShares as string, passcode)
      
      return {
        ...vault,
        keyShares: decryptedKeyShares
      }
    } catch (error) {
      throw new Error('Failed to decrypt vault: Invalid passcode')
    }
  }

  /**
   * Export vault to backup format
   */
  async exportVault(vault: Vault, options?: ExportOptions): Promise<VaultBackup> {
    // This will integrate with existing backup mutation logic
    throw new Error('exportVault not implemented yet - requires backup mutation integration')
  }

  /**
   * Import vault from backup
   */
  async importVault(backup: VaultBackup, password?: string): Promise<Vault> {
    // This will integrate with existing import logic
    throw new Error('importVault not implemented yet - requires import logic integration')
  }

  /**
   * Import vault from file (ArrayBuffer or File)
   */
  async importVaultFromFile(fileData: ArrayBuffer | File, password?: string): Promise<Vault> {
    let buffer: ArrayBuffer
    if (fileData instanceof File) {
      buffer = await fileData.arrayBuffer()
    } else {
      buffer = fileData
    }

    const fileName = fileData instanceof File ? fileData.name.toLowerCase() : ''
    const valueAsString = new TextDecoder().decode(buffer)

    // .vult (VaultContainer base64) handling
    if (fileName.endsWith('.vult')) {
      try {
        const container = vaultContainerFromString(valueAsString)
        const vaultBase64 = container.vault
        if (container.isEncrypted) {
          if (!password) throw new Error('Password required for encrypted vault')
          const decrypted = await decryptWithAesGcm({ key: password, value: fromBase64(vaultBase64) })
          const binary = new Uint8Array(decrypted)
          const comm = fromBinary(VaultSchema, binary)
          const vault = fromCommVault(comm)
          return this.normalizeVault(vault)
        }

        const binary = new Uint8Array(fromBase64(vaultBase64))
        const comm = fromBinary(VaultSchema, binary)
        const vault = fromCommVault(comm)
        return this.normalizeVault(vault)
      } catch (e) {
        throw new Error(`Failed to import .vult vault: ${(e as Error).message}`)
      }
    }

    // .dat (legacy) handling
    if (fileName.endsWith('.dat')) {
      try {
        const result = vaultBackupResultFromFileContent({ value: buffer, extension: 'dat' as any })
        if ('vault' in result) {
          return this.normalizeVault(result.vault as any)
        }
        if ('encryptedVault' in result) {
          if (!password) throw new Error('Password required for encrypted vault')
          const decrypted = await decryptWithAesGcm({ key: password, value: result.encryptedVault })
          const text = new TextDecoder().decode(decrypted)
          const data = JSON.parse(text)
          return this.parseVaultFromData(data)
        }
      } catch (e) {
        throw new Error(`Failed to import .dat vault: ${(e as Error).message}`)
      }
    }

    // Fallback: try JSON parsing (unknown extension)
    try {
      const vaultData = JSON.parse(valueAsString)
      if (password && this.isVaultDataEncrypted(vaultData)) {
        const decryptedData = await this.decryptVaultData(vaultData, password)
        return this.parseVaultFromData(decryptedData)
      }
      return this.parseVaultFromData(vaultData)
    } catch (error) {
      throw new Error(`Failed to import vault from file: ${error}`)
    }
  }

  /**
   * Check if a vault file is encrypted
   */
  async isVaultFileEncrypted(file: File): Promise<boolean> {
    try {
      const buffer = await file.arrayBuffer()
      const name = file.name.toLowerCase()
      const content = new TextDecoder().decode(buffer)

      if (name.endsWith('.vult')) {
        try {
          const container = vaultContainerFromString(content)
          return Boolean(container.isEncrypted)
        } catch {
          return false
        }
      }

      if (name.endsWith('.dat')) {
        try {
          const result = vaultBackupResultFromFileContent({ value: buffer, extension: 'dat' as any })
          return 'encryptedVault' in result
        } catch {
          return false
        }
      }

      // Fallback to JSON heuristic
      try {
        const data = JSON.parse(content)
        return this.isVaultDataEncrypted(data)
      } catch {
        return false
      }
    } catch (error) {
      return false
    }
  }

  /**
   * Helper method to check if vault data is encrypted
   */
  private isVaultDataEncrypted(vaultData: any): boolean {
    // Check for encryption markers in the vault data structure
    return vaultData.encrypted === true || 
           (typeof vaultData.keyShares === 'string' && vaultData.keyShares.startsWith('encrypted:')) ||
           vaultData.encryptedKeyShares !== undefined
  }

  /**
   * Helper method to decrypt vault data
   */
  private async decryptVaultData(vaultData: any, password: string): Promise<any> {
    // This would integrate with the existing decryption logic from core
    // For now, return as-is (needs proper implementation)
    return vaultData
  }

  /**
   * Helper method to parse vault data into Vault object
   */
  private parseVaultFromData(vaultData: any): Vault {
    const ecdsa = vaultData.public_key_ecdsa || vaultData.publicKeyEcdsa || vaultData.publicKeys?.ecdsa || ''
    const eddsa = vaultData.public_key_eddsa || vaultData.publicKeyEddsa || vaultData.publicKeys?.eddsa || ''
    return this.normalizeVault({
      name: vaultData.name || 'Imported Vault',
      publicKeys: { ecdsa, eddsa },
      localPartyId: vaultData.local_party_id || vaultData.localPartyId || 'imported',
      signers: vaultData.signers || [],
      hexChainCode: vaultData.hex_chain_code || vaultData.hexChainCode || '',
      keyShares: vaultData.key_shares || vaultData.keyShares || {},
      libType: 'DKLS',
      isBackedUp: Boolean(vaultData.isBackedUp),
      order: vaultData.order ?? 0,
      createdAt: vaultData.createdAt ?? Date.now(),
    } as Vault)
  }

  private normalizeVault(v: Vault): Vault {
    return {
      name: v.name,
      publicKeys: v.publicKeys,
      signers: v.signers,
      createdAt: v.createdAt ?? Date.now(),
      hexChainCode: v.hexChainCode,
      keyShares: v.keyShares ?? {},
      localPartyId: v.localPartyId,
      resharePrefix: (v as any).resharePrefix,
      libType: v.libType ?? 'DKLS',
      isBackedUp: v.isBackedUp ?? false,
      order: v.order ?? 0,
      folderId: (v as any).folderId,
      lastPasswordVerificationTime: (v as any).lastPasswordVerificationTime,
    }
  }

  /**
   * Get vault details and metadata
   */
  getVaultDetails(vault: Vault): VaultDetails {
    // Determine security type based on signers count
    const securityType: VaultSecurityType = vault.signers.length === 2 ? 'fast' : 'secure'
    
    return {
      name: vault.name,
      id: vault.publicKeys.ecdsa || 'unknown',
      securityType,
      threshold: vault.signers.length, // Simplified - actual threshold calculation needed
      participants: vault.signers.length,
      chains: [], // Will be derived from public keys - requires chain integration
      createdAt: vault.createdAt,
      isBackedUp: vault.isBackedUp
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

    if (vault.createdAt && Date.now() - vault.createdAt > 365 * 24 * 60 * 60 * 1000) {
      warnings.push('Vault is older than one year')
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    }
  }
}