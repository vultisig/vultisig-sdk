/**
 * Vault management module
 * Wraps existing vault handling code from core/ui/vault
 */

export { Vault } from './Vault'
export { VaultError, VaultErrorCode, VaultImportError, VaultImportErrorCode } from './VaultError'
export { AddressBookManager } from './AddressBook'
export { ChainManagement } from './ChainManagement'
export { VaultManagement } from './VaultManagement'
export { BalanceManagement } from './BalanceManagement'
export { StorageManager } from './StorageManager'
export type { StoredVault, Settings } from './StorageManager'

// Utilities
export { ValidationHelpers } from './utils/validation'

// Vault utilities - use VaultManager for encryption/decryption operations

// Re-export main vault type with alias to avoid conflict
export type { Vault as CoreVault } from '../core/ui/vault/Vault'

// Stub types for compilation - actual types come from core workspace
export type VaultFolder = any
export type VaultSecurityType = any

export type {
  ExportOptions,
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
} from '../types'

// Optional: Advanced balance providers (domain-driven design)
export * as BalanceProviders from './balance'
