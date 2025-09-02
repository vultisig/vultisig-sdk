/**
 * Vault management module
 * Wraps existing vault handling code from core/ui/vault
 */

export { Vault } from './Vault'
export { VaultError, VaultErrorCode } from './VaultError'
export { VaultManager } from './VaultManager'

// Dynamic vault utilities that will be available at runtime
export const encryptVaultKeyShares = async (
  keyShares: any,
  passcode: string
): Promise<any> => {
  const { encryptVaultKeyShares } = await import(
    '@core/ui/passcodeEncryption/core/vaultKeyShares'
  )
  return encryptVaultKeyShares({ keyShares, key: passcode })
}

export const decryptVaultKeyShares = async (
  encryptedData: any,
  passcode: string
): Promise<any> => {
  const { decryptVaultKeyShares } = await import(
    '@core/ui/passcodeEncryption/core/vaultKeyShares'
  )
  return decryptVaultKeyShares({ keyShares: encryptedData, key: passcode })
}

// Re-export main vault type with alias to avoid conflict
export type { Vault as CoreVault } from '@core/ui/vault/Vault'

// Stub types for compilation - actual types come from core workspace
export type VaultFolder = any
export type VaultSecurityType = any

export type {
  ExportOptions,
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
} from '../types'
