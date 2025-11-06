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

// NOTE: WASM management is internal-only
// WalletCore initialization is handled by the SDK

// ============================================================================
// PUBLIC API - Environment Utilities
// ============================================================================

// Environment detection
export {
  detectEnvironment,
  isBrowser,
  isNode,
  isElectron,
  isElectronMain,
  isElectronRenderer,
  isChromeExtension,
  isChromeExtensionServiceWorker,
  isChromeExtensionPage,
  isWorker,
  getEnvironmentInfo,
} from './runtime/environment'

export type { Environment } from './runtime/environment'

// Storage implementations
export { StorageManager } from './runtime/storage/StorageManager'
export type { StorageOptions } from './runtime/storage/StorageManager'
export { BrowserStorage } from './runtime/storage/BrowserStorage'
export { NodeStorage } from './runtime/storage/NodeStorage'
export { MemoryStorage } from './runtime/storage/MemoryStorage'
export { ChromeStorage } from './runtime/storage/ChromeStorage'

export { StorageError, StorageErrorCode } from './runtime/storage/types'

export type {
  VaultStorage,
  StorageMetadata,
  StoredValue,
} from './runtime/storage/types'

// Event system
export { UniversalEventEmitter } from './events/EventEmitter'
export type { SdkEvents, VaultEvents } from './events/types'

// ============================================================================
// PUBLIC API - Environment-Specific Utilities
// ============================================================================

// Electron utilities
export {
  setupElectronIPC,
  getElectronHandlers,
  getElectronProcessType,
  exportElectronVaultToFile,
  downloadElectronVault,
} from './runtime/utils/electron'

// Node.js utilities
export {
  exportVaultToFile,
  importVaultFromFile,
  getStoragePath,
  getNodeStorageInfo,
  ensureDirectory,
} from './runtime/utils/node'

// Browser utilities
export {
  downloadVault,
  getBrowserStorageInfo,
  isBrowserStorageLow,
  requestPersistentStorage,
  isPersistentStorage,
  uploadVaultFile,
} from './runtime/utils/browser'

// Chrome extension utilities
export {
  setupChromeMessageHandlers,
  sendChromeMessage,
  keepServiceWorkerAlive,
  isServiceWorkerAlive,
  onChromeStorageChanged,
} from './runtime/utils/chrome'

// ============================================================================
// PUBLIC API - Types (keep all types for TypeScript users)
// ============================================================================

// General types
export type {
  Balance,
  CachedBalance,
  SigningMode,
  SigningPayload,
  Signature,
  ServerStatus,
  KeygenProgressUpdate,
  AddressBook,
  AddressBookEntry,
  ValidationResult,
  VaultOptions,
  VaultBackup,
  VaultDetails,
  VaultValidationResult,
  ExportOptions,
  FastSigningInput,
  ReshareOptions,
  SDKConfig,
  ChainConfig,
  AddressResult,
  VaultType,
  KeygenMode,
  VaultManagerConfig,
  VaultCreationStep,
  SigningStep,
  VaultSigner,
  Summary,
  Token,
  Value,
  GasInfo,
  GasEstimate,
  // Extended SDK types (from refactor)
  VultisigConfig,
  VaultSummary,
} from './types'
