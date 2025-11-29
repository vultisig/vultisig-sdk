/**
 * Vault management module
 * Provides polymorphic vault hierarchy with type-specific implementations
 */

// Import and export vault class hierarchy
import { FastVault } from './FastVault'
import { SecureVault } from './SecureVault'
import { VaultBase } from './VaultBase'

export { FastVault, SecureVault, VaultBase }

// Export errors
export { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from './VaultError'

// Export vault configuration
export type { VaultConfig } from './VaultServices'

// NOTE: Type guards (isFastVault, isSecureVault) are static methods on Vultisig class
// Use: Vultisig.isFastVault(vault) and Vultisig.isSecureVault(vault)

// Re-export core vault type with alias to avoid conflict
export type { Vault as CoreVault } from '@core/mpc/vault/Vault'

// Stub types for compilation - actual types come from core workspace
export type VaultFolder = any
export type VaultSecurityType = any

export type { ExportOptions, VaultBackup, VaultDetails, VaultValidationResult } from '../types'
