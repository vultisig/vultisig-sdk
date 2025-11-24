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

// Type guards for vault types
export function isFastVault(vault: VaultBase): vault is FastVault {
  return vault.type === 'fast'
}

export function isSecureVault(vault: VaultBase): vault is SecureVault {
  return vault.type === 'secure'
}

// Re-export core vault type with alias to avoid conflict
export type { Vault as CoreVault } from '@core/mpc/vault/Vault'

// Stub types for compilation - actual types come from core workspace
export type VaultFolder = any
export type VaultSecurityType = any

export type { ExportOptions, VaultBackup, VaultDetails, VaultValidationResult } from '../types'
