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

// Core SDK class
export { Vultisig } from './VultisigSDK'
export { Vultisig as VultisigSDK } from './VultisigSDK'

// Vault management
export { 
  Vault,
  VaultError, 
  VaultErrorCode, 
  VaultImportError, 
  VaultImportErrorCode,
  AddressBookManager,
  ChainManagement,
  VaultManagement,
  BalanceManagement,
  ValidationHelpers
} from './vault'

// MPC operations
export * from './mpc'

// Chain operations
export { ChainManager, AddressDeriver } from './chains'

// Server communication
export * from './server'

// Cryptographic utilities
export * from './crypto'

// Types and interfaces - specific exports to avoid conflicts
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
  GasEstimate
} from './types'

// WASM utilities
export * from './wasm'

// Types are already exported via export * from './types' above
