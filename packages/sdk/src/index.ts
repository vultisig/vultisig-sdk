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
// PUBLIC API - Conversion / Normalization Utilities (vault-free)
// ============================================================================

export type { FiatToAmountParams } from './utils/fiatToAmount'
export { fiatToAmount, FiatToAmountError } from './utils/fiatToAmount'
export { normalizeChain, UnknownChainError } from './utils/normalizeChain'

// Pure address-format validation (vault-free, no network, no signing):
//   sdk.validate.chainPrefix(address, chain) — HRP/format mismatch check
//   sdk.address.classify(address)            — chain family of an address
//   sdk.address.isValidFor(address, chain)   — is the format valid for a chain
// Canonical port of the Go agent-backend chain-prefix / per-family address
// FORMAT rules (collapses the Go + abt duplicates).
export {
  canonicalChainTag,
  classifyAddress,
  isAddressValidForChain,
  isSolanaAddress,
  supportedChainTags,
} from './utils/addressFormat'
export type { AddressFamily, AddressRole, ChainPrefixResult } from './utils/addressValidation'
export { address, validate } from './utils/addressValidation'
export { checkChainPrefix } from './utils/chainPrefix'

// ============================================================================
// PUBLIC API - Tx Shape Normalization (pure, vault-free)
// ============================================================================

// Canonicalize a build_* tool result into a signing-ready tx envelope and split
// multi-tx build results (approve+swap, generic transactions[]) into ordered
// legs. Ports the normalize/split half of the agent-backend's
// enrichBuildResult + splitMultiTx; SSE/Redis sequencing stays in the backend.
export type { NormalizeArgs, NormalizedTx } from './tx'
export { normalizeTx, splitMultiTx, TxNormalizeError } from './tx'

// ============================================================================
// PUBLIC API - Canonical Contract / Token Registry (knownContracts)
// ============================================================================

export {
  canonicalEvmContracts,
  canonicalSolanaAddresses,
  canonicalTronContracts,
  isCanonicalEvmContract,
  isCanonicalEvmContractEllipsized,
  isCanonicalSolanaAddress,
  isCanonicalSolanaAddressEllipsized,
  isCanonicalTronContract,
  isEvmAddressFormat,
  isKnownContract,
  knownContracts,
} from './utils/knownContracts'

// ============================================================================
// PUBLIC API - Station Migration Primitives
// ============================================================================

export type {
  StationImportSource,
  StationMnemonicImportSource,
  StationPrivateKeyImportSource,
  StationSeedImportSource,
  StationTerraChain,
  StationTerraChainPublicData,
  StationTerraCoinType,
  StationTerraKeyMaterial,
} from '@vultisig/core-chain/station/importPrimitives'
export {
  deriveStationTerraKeyMaterial,
  getStationTerraDerivationPath,
  normalizeStationPrivateKeyHex,
  stationTerraCoinTypes,
  validateStationPrivateKeyHex,
} from '@vultisig/core-chain/station/importPrimitives'

// ============================================================================
// PUBLIC API - Chain Configuration
// ============================================================================

// Supported chains constants
export {
  assertSeedphraseImportSupportsChains,
  getUnsupportedSeedphraseImportChains,
  isSeedphraseImportSupportedChain,
  SEEDPHRASE_IMPORT_SUPPORTED_CHAINS,
  SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS,
  SUPPORTED_CHAINS,
} from './Vultisig'

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
export type { Chain as ChainType, CosmosChain, EvmChain, OtherChain, UtxoChain } from './types'
export { Chain } from './types'

// Chain-kind classification — the canonical 12-family dispatch key. Exposed so
// downstream consumers (mcp-ts, agent-backend) route through the SDK instead of
// re-inventing per-chain classification tables (the cross-repo drift root cause).
export type { ChainKind } from '@vultisig/core-chain/ChainKind'
export { getChainKind, isChainOfKind } from '@vultisig/core-chain/ChainKind'

// Cosmos chain metadata — surfaced so consumers stop re-declaring LCD urls /
// fee denoms / gas limits (e.g. mcp-ts lib/cosmos-chains.ts).
export { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
export { getCosmosGasLimit, getCosmosStakingGasLimit } from '@vultisig/core-chain/chains/cosmos/cosmosGasLimitRecord'
export { cosmosRpcUrl } from '@vultisig/core-chain/chains/cosmos/cosmosRpcUrl'

// Fiat currency types
export type { FiatCurrency } from '@vultisig/core-config/FiatCurrency'
export {
  defaultFiatCurrency,
  fiatCurrencies,
  fiatCurrencyNameRecord,
  fiatCurrencySymbolRecord,
} from '@vultisig/core-config/FiatCurrency'

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
  CompoundSwapResult,
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
  MessageSignature,
  NativeSwapQuote,
  OtherGasInfo,
  Portfolio,
  ReshareOptions,
  SDKConfig,
  SendResult,
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
  TxReceiptInfo,
  TxStatusResult,
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

// Swap explorer URL helper (parity with iOS ExplorerLinkBuilder /
// Android ExplorerLinkRepository.getSwapProgressLink). Use this instead of
// chain-only explorer URLs when rendering swap tx history.
export type { GetSwapExplorerUrlInput, SwapExplorerProvider } from '@vultisig/core-chain/swap/utils/getSwapExplorerUrl'
export { getSwapExplorerUrl, swapExplorerProviders } from '@vultisig/core-chain/swap/utils/getSwapExplorerUrl'

// Noon USDC yield vault SDK boundary. Consumers should use these helpers
// instead of calling Noon/Accountable APIs or hand-encoding ERC-7540 calldata.
export type {
  NoonContractCall,
  NoonDepositTxPlan,
  NoonVaultMetrics,
  NoonVaultPosition,
  NoonVaultQueue,
  NoonVaultState,
} from '@vultisig/core-chain/chains/evm/noon'
export {
  encodeNoonDeposit,
  encodeNoonRequestRedeem,
  encodeNoonUsdcApprove,
  encodeNoonWithdraw,
  fetchNoonUsdcVaultApy,
  fetchNoonUsdcVaultMetrics,
  fetchNoonUsdcVaultTvl,
  getNoonDepositContractCall,
  getNoonDepositTxPlan,
  getNoonRequestRedeemContractCall,
  getNoonUsdcAllowance,
  getNoonUsdcApproveContractCall,
  getNoonWithdrawContractCall,
  noonUsdcVaultConfig,
  noonVaultAbi,
  readNoonClaimableRedeemRequest,
  readNoonPendingRedeemRequest,
  readNoonVaultConvertToAssets,
  readNoonVaultMinAmountWei,
  readNoonVaultPosition,
  readNoonVaultPreviewDeposit,
  readNoonVaultPreviewRedeem,
  readNoonVaultPreviewWithdraw,
  readNoonVaultQueue,
  readNoonVaultSharePrice,
  readNoonVaultState,
  readNoonWithdrawalRequestRaw,
  readNoonWithdrawalRequestsRaw,
} from '@vultisig/core-chain/chains/evm/noon'

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

// Reshare types
export type { PerformReshareParams } from './services/SecureVaultCreationService'

// QR payload parsing (for programmatic multi-device coordination)
export type { ParsedKeygenQR } from './utils/parseKeygenQR'
export { parseKeygenQR } from './utils/parseKeygenQR'

// Notification server vault_id (cross-platform, matches iOS)
export { computeNotificationVaultId } from './utils/computeNotificationVaultId'

// ============================================================================
// PUBLIC API - Discount Tier Configuration
// ============================================================================

// VULT discount tier config (for CLI and other consumers)
export type { VultDiscountTier } from '@vultisig/core-chain/swap/affiliate/config'
export {
  baseAffiliateBps,
  vultDiscountTierBps,
  vultDiscountTierMinBalances,
  vultDiscountTiers,
} from '@vultisig/core-chain/swap/affiliate/config'
export type { LifiAffiliateConfig, LifiBootstrapConfig } from '@vultisig/core-chain/swap/general/lifi/config'
export { setupLifi } from '@vultisig/core-chain/swap/general/lifi/config'
export type { SwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
export { configureSwapKit, getSwapKitConfig } from '@vultisig/core-chain/swap/general/swapkit/config'
export type { SwapAffiliateConfig } from '@vultisig/core-chain/swap/quote/findSwapQuote'

// THORChain LP primitives (v2: auto-pair, lockup, halts, mimir pause gate)
export { getThorchainInboundAddress } from '@vultisig/core-chain/chains/cosmos/thor/getThorchainInboundAddress'
export * from '@vultisig/core-chain/chains/cosmos/thor/lp'

// Cosmos staking + distribution module (LCD queries — read-only, generic over
// every ibcEnabled cosmos chain). Signing primitives ship via
// `chains.cosmos.buildCosmosStakingTx` from the platform-specific entry point.
export type {
  ContinuousVestingAccount,
  Coin as CosmosStakingCoin,
  DelayedVestingAccount,
  Delegation,
  DelegatorReward,
  DelegatorRewardsResponse,
  PeriodicVestingAccount,
  UnbondingDelegation,
  UnbondingEntry,
  VestingAccount,
} from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'
export {
  getAuthAccountUrl,
  getCosmosDelegations,
  getCosmosDelegatorRewards,
  getCosmosUnbondingDelegations,
  getCosmosVestingAccount,
  getDelegationsUrl,
  getDelegatorRewardsUrl,
  getUnbondingDelegationsUrl,
} from '@vultisig/core-chain/chains/cosmos/staking/lcdQueries'

// Cosmos governance (read proposals + build unsigned MsgVote envelope —
// read-only / builds-unsigned, never signs or broadcasts).
export type {
  CosmosVoteEnvelope,
  GetCosmosGovernanceProposalsParams,
  GetGovernanceProposalsResult,
  GovChain,
  GovernanceProposal,
  PrepareCosmosVoteParams,
  ProposalStatus,
  VoteOption,
  VoteTally,
} from './tools/cosmos'
export { getCosmosGovernanceProposals, prepareCosmosVote } from './tools/cosmos'

// ============================================================================
// PUBLIC API - Token Registry & Chain Data
// ============================================================================

export type {
  CoinPricesParams,
  CoinPricesResult,
  CoinPricesWithChangeResult,
  CoinPriceWithChange,
  DiscoveredToken,
  FeeCoinInfo,
  TokenInfo,
} from './types'

// ============================================================================
// PUBLIC API - Security Scanning
// ============================================================================

export type {
  AddressScanResult,
  RiskLevel,
  SiteScanResult,
  TransactionSimulationResult,
  TransactionValidationResult,
} from './types'

// ============================================================================
// PUBLIC API - Cosmos Message Type Constants
// ============================================================================

export { CosmosMsgType } from './types'

// ============================================================================
// PUBLIC API - Tools (vault-free chain utilities)
// ============================================================================

export type {
  AmountUnits,
  AssetRef,
  BuildBuyPtParams,
  BuildGlifRedeemParams,
  BuildGlifRedeemResult,
  BuildGlifStakeParams,
  BuildGlifStakeResult,
  BuildRedeemParams,
  BuildSellPtParams,
  BuildThreeJaneSupplyUsdcParams,
  BuildThreeJaneSupplyUsdcResult,
  ChainFamily,
  Coin,
  CoinKey,
  CoinMetadata,
  DecodeFromToolResultInput,
  Defi,
  Envelope,
  EnvelopeKind,
  FieldDiff,
  FindSwapQuoteParams,
  GetMaxSendAmountFromKeysParams,
  GlifUnsignedTx,
  IntentClaim,
  InvariantInput,
  InvariantViolation,
  KnownCoin,
  KnownCoinMetadata,
  PendleActiveMarket,
  PendleChain,
  PendleMarketParams,
  PendleMarketsParams,
  PendleMarketSummary,
  PendlePtBuildResult,
  PendleUnsignedTx,
  PolicyAssetRef,
  PolicyEnvelope,
  PrepareSendTxFromKeysParams,
  PrepareSwapTxFromKeysParams,
  RecipientSanityFlag,
  RecipientSanityInput,
  RecipientSanityResult,
  ThreeJaneTranche,
  ThreeJaneTxStep,
  TokenMetadataResolver,
  VaultIdentity,
  Verdict,
} from './tools'
export {
  abiDecode,
  abiEncode,
  AMOUNT_DRIFT_BLOCK_PCT,
  AMOUNT_DRIFT_WARN_PCT,
  amountDriftPct,
  buildBuyPt,
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  buildRedeem,
  buildSellPt,
  chainAliasMap,
  chainFeeCoin,
  chainsMatch,
  checkInvariants,
  claimInterpretations,
  decodeCosmosTx,
  decodeEvmTx,
  decodeFromToolResult,
  defi,
  deriveAddressFromKeys,
  dex,
  evaluatePolicy,
  evmCall,
  evmCheckAllowance,
  evmTxInfo,
  findSwapQuote,
  getCoinBalance,
  getMaxSendAmountFromKeys,
  getNativeSwapDecimals,
  getPublicKey,
  getTokenMetadata,
  getTxStatus,
  GLIF_ICN_BASE_ADDRESSES,
  GLIF_ICN_TOKEN_DECIMALS,
  glifPoolWriteAbi,
  Invariant,
  isMalformedEvmAddress,
  isNullAddress,
  isPendleChain,
  isSelfSend,
  isZeroAmount,
  knownTokens,
  knownTokensIndex,
  parseAmountBig,
  pendle,
  PENDLE_ROUTER_V4,
  PENDLE_SUPPORTED_CHAINS,
  PendleBuildError,
  pendleMarket,
  pendleMarkets,
  PLAUSIBLE_TOKEN_DECIMALS,
  policy,
  prepareContractCallTxFromKeys,
  prepareSendTxFromKeys,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  prepareSwapTxFromKeys,
  recipientSanity,
  resolve4ByteSelector,
  resolveEns,
  ResultKind,
  sanitizeAmount,
  scaleDecimalClaimToAtomic,
  searchToken,
  stripChainPrefix,
  VerifierClient,
} from './tools'

// ============================================================================
// PUBLIC API - Push Notifications
// ============================================================================

export { PushNotificationService } from './services/PushNotificationService'
export type {
  NotificationPayload,
  NotifyVaultMembersOptions,
  PushDeviceType,
  PushNotificationRegistration,
  PushToken,
  RegisterDeviceOptions,
  SigningNotification,
  WSConnectionState,
  WSConnectOptions,
} from './types/notifications'

// ============================================================================
// PUBLIC API - ABI Constants
// ============================================================================

export { ERC20_ABI, ERC1155_ABI } from './abi'
