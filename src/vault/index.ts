/**
 * Vault management module
 * Wraps existing vault handling code from core/ui/vault
 */

export { VaultManager } from './VaultManager'

// Dynamic vault utilities that will be available at runtime
export const encryptVaultKeyShares = async (keyShares: any, passcode: string): Promise<any> => {
  const { encryptVaultKeyShares } = await import('@core/ui/passcodeEncryption/core/vaultKeyShares')
  return encryptVaultKeyShares(keyShares, passcode)
}

export const decryptVaultKeyShares = async (encryptedData: any, passcode: string): Promise<any> => {
  const { decryptVaultKeyShares } = await import('@core/ui/passcodeEncryption/core/vaultKeyShares')
  return decryptVaultKeyShares(encryptedData, passcode)
}

// Re-export main vault type
export type { Vault } from '@core/ui/vault/Vault'

// Stub types for compilation - actual types come from core workspace
export type VaultFolder = any
export type VaultSecurityType = any

export type {
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
  ExportOptions
} from '../types'