/**
 * VultisigSDK - TypeScript SDK for secure multi-party computation and blockchain operations
 *
 * This SDK provides a clean interface to Vultisig's core functionality:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 *
 * Phase 5: Cleaned up to export only public API
 * Internal chain utilities (parsers, builders, etc.) are now internal-only
 */

// ============================================================================
// PUBLIC API - Core Classes
// ============================================================================

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
  // Phase 7: BalanceManagement removed - redundant with AddressService and BalanceService
  // BalanceManagement,
  ValidationHelpers,
  createVaultBackup,
  getExportFileName,
} from './vault'

// ============================================================================
// PUBLIC API - Operations
// ============================================================================

// NOTE: MPC implementation is internal-only
// Users interact via: sdk.createVault() and vault.sign()
// MPC types are exported from './types' section below

// NOTE: ChainManager and AddressDeriver are internal implementation details
// Users should interact via Vultisig and Vault classes only
// Removed from public exports (Phase 5 cleanup)

// NOTE: ServerManager is internal-only
// Users access server-assisted signing via: vault.sign('fast', payload)
// Server types (ServerStatus, ReshareOptions, FastSigningInput) are exported from './types' section below

// NOTE: Cryptographic utilities are internal-only
// Users don't need direct access to crypto primitives

// NOTE: WASM management is internal-only
// WalletCore initialization is handled by the SDK

// ============================================================================
// Phase 5: Chain-specific utilities are now INTERNAL ONLY
// ============================================================================
// Users should interact via:
// - vault.address(chain) - for addresses
// - vault.balance(chain) - for balances
// - vault.sign(mode, payload) - for signing
//
// Internal utilities moved to services and strategies:
// - parseSolanaTransaction → SolanaStrategy (internal)
// - parseEvmTransaction → EvmStrategy (internal)
// - buildEvmKeysignPayload → EvmStrategy (internal)
// - Gas utilities → EvmStrategy.estimateGas() (internal)
// - Token utilities → Strategy pattern (internal)
// ============================================================================

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
  GasEstimate
  // Solana types removed - use core types directly
} from './types'

// EVM types removed - use core types directly
// (chains/evm directory deleted in functional adapter refactor)
