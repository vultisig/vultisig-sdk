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

// EVM chain utilities
export {
  // Transaction parsers
  parseEvmTransaction,
  parseErc20TransferFrom,
  getFunctionSelector,
  Erc20Parser,
  UniswapParser,
  OneInchParser,
  NftParser,
  // Keysign utilities
  buildEvmKeysignPayload,
  getEvmSpecific,
  updateEvmSpecific,
  // Gas utilities
  estimateTransactionGas,
  calculateMaxGasCost,
  calculateExpectedGasCost,
  compareGasEstimates,
  formatGasPrice,
  parseGasPrice,
  weiToGwei,
  gweiToWei,
  weiToEth,
  ethToWei,
  compareGasPrices,
  calculateGasPriceChange,
  formatGasPriceAuto,
  getGasPriceCategory,
  // Token utilities
  getTokenBalance,
  getTokenAllowance,
  formatTokenAmount,
  parseTokenAmount,
  isAllowanceSufficient,
  calculateAllowanceShortfall,
  formatTokenWithSymbol,
  compareAmounts,
  getTokenMetadata,
  buildToken,
  getNativeToken,
  batchGetTokenMetadata,
  isValidTokenAddress,
  normalizeTokenAddress,
  // Configuration
  EVM_CHAIN_IDS,
  NATIVE_TOKEN_ADDRESS,
  COMMON_TOKENS,
  DEX_ROUTERS,
  ERC20_SELECTORS,
  ERC721_SELECTORS,
  ERC1155_SELECTORS,
  ERC20_ABI,
  getChainId,
  getChainFromId,
  isNativeToken,
  isEvmChain,
  getCommonToken,
} from './chains/evm'

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

// EVM types
export type {
  EvmToken,
  EvmTransactionType,
  EvmProtocol,
  DecodedContractCall,
  EvmTransferParams,
  EvmSwapParams,
  EvmNftParams,
  EvmApproveParams,
  ParsedEvmTransaction,
  EvmTransactionInput,
  EvmKeysignOptions,
  EvmSignature,
  EvmGasEstimate,
  FormattedGasPrice
} from './chains/evm'

// WASM utilities
export * from './wasm'

// Types are already exported via export * from './types' above
