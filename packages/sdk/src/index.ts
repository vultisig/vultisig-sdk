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
  SecureVault,
  VaultBase,
  VaultError,
  VaultErrorCode,
  VaultImportError,
  VaultImportErrorCode,
} from './vault'

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
  BytesInput,
  CachedBalance,
  ChainConfig,
  CoinInput,
  // Cosmos signing types
  CosmosCoinAmount,
  CosmosFeeInput,
  CosmosGasInfo,
  CosmosMsgInput,
  CosmosSigningOptions,
  EvmGasInfo,
  ExportOptions,
  GasEstimate,
  GasInfo,
  GasInfoForChain,
  GeneralSwapProvider,
  GeneralSwapQuote,
  KeygenMode,
  KeygenProgressUpdate,
  KeysignPayload,
  MaxSendAmount,
  NativeSwapQuote,
  OtherGasInfo,
  ReshareOptions,
  SDKConfig,
  ServerStatus,
  SignAminoInput,
  Signature,
  SignBytesOptions,
  SignDirectInput,
  SigningMode,
  SigningPayload,
  SigningStep,
  SimpleCoinInput,
  SwapApprovalInfo,
  SwapFees,
  SwapPrepareResult,
  // Swap types
  SwapQuote,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapTxParams,
  Token,
  UtxoGasInfo,
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
// Swap type guards
export { isAccountCoin, isSimpleCoinInput, KeysignPayloadSchema } from './types'

// ============================================================================
// PUBLIC API - Seedphrase & Multi-Device Vault Creation
// ============================================================================

// Seedphrase validation and vault creation from seedphrase types
export type {
  ChainDiscoveryPhase,
  ChainDiscoveryProgress,
  ChainDiscoveryResult,
  CreateFastVaultFromSeedphraseOptions,
  CreateSecureVaultFromSeedphraseOptions,
  JoinSecureVaultOptions,
  SeedphraseImportResult,
  SeedphraseValidation,
  SeedphraseWordCount,
} from './seedphrase'
export { SEEDPHRASE_WORD_COUNTS, validateSeedphrase } from './seedphrase'

// QR payload parsing (for programmatic multi-device coordination)
export type { ParsedKeygenQR } from './utils/parseKeygenQR'
export { parseKeygenQR } from './utils/parseKeygenQR'

// ============================================================================
// PUBLIC API - Discount Tier Configuration
// ============================================================================

// VULT discount tier config (for CLI and other consumers)
export type { VultDiscountTier } from '@core/chain/swap/affiliate/config'
export {
  baseAffiliateBps,
  vultDiscountTierBps,
  vultDiscountTierMinBalances,
  vultDiscountTiers,
} from '@core/chain/swap/affiliate/config'

// ============================================================================
// PUBLIC API - Token Registry & Chain Data
// ============================================================================

export type { CoinPricesParams, CoinPricesResult, DiscoveredToken, FeeCoinInfo, TokenInfo } from './types'

// ============================================================================
// PUBLIC API - Security Scanning
// ============================================================================

export type { RiskLevel, SiteScanResult, TransactionSimulationResult, TransactionValidationResult } from './types'

// ============================================================================
// PUBLIC API - Cosmos Message Type Constants
// ============================================================================

export { CosmosMsgType } from './types'
