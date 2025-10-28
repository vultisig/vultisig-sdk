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
  Vault,
  VaultError,
  VaultErrorCode,
  VaultImportError,
  VaultImportErrorCode,
  AddressBookManager,
  ChainManagement,
  VaultManagement,
  BalanceManagement,
  ValidationHelpers,
  createVaultBackup,
  getExportFileName,
} from './vault'

// MPC operations
export * from './mpc'

// Chain operations
export { ChainManager, AddressDeriver } from './chains'

// Solana chain utilities
export {
  parseSolanaTransaction,
  resolveAddressTableKeys,
  buildSolanaKeysignPayload,
  getSolanaSpecific,
  updateSolanaSpecific,
  JupiterInstructionParser,
  RaydiumInstructionParser,
  JUPITER_V6_PROGRAM_ID,
  RAYDIUM_AMM_PROGRAM_ID,
  SOLANA_PROGRAM_IDS,
} from './chains/solana'

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
  GasEstimate,
  SolanaToken,
  PartialInstruction,
  AddressTableLookup,
  ParsedSolanaTransaction,
  ParsedSolanaSwapParams,
  SolanaTransactionInput,
  SolanaKeysignOptions,
  SolanaSignature
} from './types'

// WASM utilities
export * from './wasm'

// Types are already exported via export * from './types' above
