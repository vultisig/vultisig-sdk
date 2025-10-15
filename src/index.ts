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

// Vault management
export {
  AddressBookManager,
  BalanceManagement,
  ChainManagement,
  ValidationHelpers,
  Vault,
  VaultError,
  VaultErrorCode,
  VaultImportError,
  VaultImportErrorCode,
  VaultManagement,
} from './vault'

// MPC operations
export * from './mpc'

// Chain operations
export { AddressDeriver, ChainManager } from './chains'

// Server communication
export * from './server'

// Cryptographic utilities
export * from './crypto'

// Types and interfaces - specific exports to avoid conflicts
export type {
  AddressBook,
  AddressBookEntry,
  AddressResult,
  Balance,
  BroadcastOptions,
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
  SignedTransaction,
  SigningMode,
  SigningPayload,
  SigningStep,
  Summary,
  Token,
  TransactionReceipt,
  ValidationResult,
  Value,
  VaultBackup,
  VaultCreationStep,
  VaultDetails,
  VaultManagerConfig,
  VaultOptions,
  VaultSigner,
  VaultType,
  VaultValidationResult,
} from './types'

// WASM utilities
export * from './wasm'

// Types are already exported via export * from './types' above
