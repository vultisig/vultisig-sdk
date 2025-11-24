/**
 * VultisigSDK - TypeScript SDK for secure multi-party computation and blockchain operations
 *
 * This SDK provides a clean interface to Vultisig's core functionality:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 */

// ============================================================================
// PUBLIC API - Core Classes
// ============================================================================

// Core SDK class
export { Vultisig } from './Vultisig'

// Vault management
export type { VaultConfig } from './vault'
export {
  FastVault,
  isFastVault,
  isSecureVault,
  SecureVault,
  VaultBase,
  VaultError,
  VaultErrorCode,
  VaultImportError,
  VaultImportErrorCode,
} from './vault'

// ============================================================================
// PUBLIC API - Operations
// ============================================================================

// NOTE: MPC implementation is internal-only
// Users interact via: sdk.createVault() and vault.sign()
// MPC types are exported from './types' section below

// NOTE: ChainManager and AddressDeriver are internal implementation details
// Users should interact via Vultisig and Vault classes only

// NOTE: ServerManager is internal-only
// Users access server-assisted signing via: vault.sign('fast', payload)
// Server types (ServerStatus, ReshareOptions, FastSigningInput) are exported from './types' section below

// NOTE: Cryptographic utilities are internal-only
// Users don't need direct access to crypto primitives

// WASM Management (now static - no instance needed)
export type { WasmConfig } from './wasm'
export { WasmManager } from './wasm'

// Crypto initialization
export { initializeCrypto } from './crypto'

// ============================================================================
// PUBLIC API - Server Management
// ============================================================================

// Global server manager singleton
export { GlobalServerManager, type ServerEndpoints } from './server'

// ============================================================================
// PUBLIC API - Configuration
// ============================================================================

// Global configuration singleton
export { GlobalConfig, type GlobalConfigOptions } from './config'

// ============================================================================
// PUBLIC API - Validation Utilities
// ============================================================================

// Validation helpers
export { ValidationHelpers } from './utils/validation'

// ============================================================================
// PUBLIC API - Chain Configuration
// ============================================================================

// Supported chains constant
export { SUPPORTED_CHAINS } from './Vultisig'

// ============================================================================
// PUBLIC API - Storage
// ============================================================================

// Storage system - MemoryStorage is available in all platforms
export type { StorageMetadata, StoredValue, Storage as VaultStorage } from './storage'
export { MemoryStorage } from './storage'
export { StorageError, StorageErrorCode } from './storage'

// Event system
export { UniversalEventEmitter } from './events/EventEmitter'
export type { SdkEvents, VaultEvents } from './events/types'

// ============================================================================
// PUBLIC API - Types (keep all types for TypeScript users)
// ============================================================================

// Chain enums and types
export type { Chain as ChainType } from './types'
export { Chain } from './types'

// Fiat currency types
export type { FiatCurrency } from '@core/config/FiatCurrency'
export {
  defaultFiatCurrency,
  fiatCurrencies,
  fiatCurrencyNameRecord,
  fiatCurrencySymbolRecord,
} from '@core/config/FiatCurrency'

// General types
export type {
  AddressBook,
  AddressBookEntry,
  AddressResult,
  Balance,
  CachedBalance,
  ChainConfig,
  ExportOptions,
  FastSigningInput,
  GasEstimate,
  GasInfo,
  KeygenMode,
  KeygenProgressUpdate,
  ReshareOptions,
  SDKConfig,
  ServerStatus,
  Signature,
  SigningMode,
  SigningPayload,
  SigningStep,
  Token,
  ValidationResult,
  Value,
  VaultBackup,
  VaultCreationStep,
  VaultDetails,
  VaultOptions,
  VaultSummary,
  VaultType,
  VaultValidationResult,
  // Extended SDK types (from refactor)
  VultisigConfig,
} from './types'
