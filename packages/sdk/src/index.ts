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
export {
  Vault,
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
export type { WasmConfig } from './runtime/wasm'
export { WasmManager } from './runtime/wasm'

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
// PUBLIC API - Environment Utilities
// ============================================================================

// Environment detection
export type { Environment } from './runtime/environment'
export {
  detectEnvironment,
  getEnvironmentInfo,
  isBrowser,
  isChromeExtension,
  isChromeExtensionPage,
  isChromeExtensionServiceWorker,
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isNode,
  isWorker,
} from './runtime/environment'

// Storage implementations
export { BrowserStorage } from './runtime/storage/BrowserStorage'
export { ChromeStorage } from './runtime/storage/ChromeStorage'
export { MemoryStorage } from './runtime/storage/MemoryStorage'
export { NodeStorage } from './runtime/storage/NodeStorage'
export type { StorageOptions } from './runtime/storage/StorageManager'
export { StorageManager } from './runtime/storage/StorageManager'
export type {
  StorageMetadata,
  StoredValue,
  Storage as VaultStorage,
} from './runtime/storage/types'
export { StorageError, StorageErrorCode } from './runtime/storage/types'

// Event system
export { UniversalEventEmitter } from './events/EventEmitter'
export type { SdkEvents, VaultEvents } from './events/types'

// ============================================================================
// PUBLIC API - Environment-Specific Utilities
// ============================================================================

// Electron utilities - TODO: Re-enable when Electron integration is ready
// export {
//   downloadElectronVault,
//   exportElectronVaultToFile,
//   getElectronHandlers,
//   getElectronProcessType,
//   setupElectronIPC,
// } from './runtime/utils/electron'

// Node.js utilities
export {
  ensureDirectory,
  exportVaultToFile,
  getNodeStorageInfo,
  getStoragePath,
  importVaultFromFile,
} from './runtime/utils/node'

// Browser utilities
export {
  downloadVault,
  getBrowserStorageInfo,
  isBrowserStorageLow,
  isPersistentStorage,
  requestPersistentStorage,
  uploadVaultFile,
} from './runtime/utils/browser'

// Chrome extension utilities
export {
  isServiceWorkerAlive,
  keepServiceWorkerAlive,
  onChromeStorageChanged,
  sendChromeMessage,
  setupChromeMessageHandlers,
} from './runtime/utils/chrome'

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
