// Address derivation
export { deriveAddressFromKeys } from './address'

// DeFi protocol primitives (sdk.defi.*) — unsigned-tx builders only
export * from './defi'

// Pure-crypto balance reads (Polkadot DOT + Assets-pallet)
export {
  balancePolkadot,
  DOT_DECIMALS,
  formatDot,
  getPolkadotAssetBalance,
  getPolkadotNativeBalance,
  type PolkadotAssetBalance,
  type PolkadotNativeBalance,
} from './balance'

// EVM utilities
export type { EvmGasPrice, GetTokenApprovalsResult, TokenApproval } from './evm'
export {
  abiDecode,
  abiEncode,
  encodeErc20Approve,
  encodeErc20Revoke,
  evmCall,
  evmCheckAllowance,
  evmGasPrice,
  evmTxInfo,
  getTokenApprovals,
  MAX_UINT256,
  resolve4ByteSelector,
  resolveEns,
} from './evm'

// Balance reads (pure decode + decimal-scale, no signing/broadcast)
export type { CosmosBalanceChain, CosmosBalanceEntry, CosmosBalanceResult } from './balance'
export { cosmosBalanceChains, getCosmosBalance, isCosmosBalanceChain } from './balance'

// Canonical bytes oracle (calldata -> chain-agnostic Envelope)
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './decode'
export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult } from './decode'

// DEX primitives (read-only / pure math + on-chain quotes — no signing, no broadcast)
export * as dex from './dex'

// Gas / fee fan-out
export type { CompareCostsEntry, CompareCostsParams, CompareCostsResult, CompareCostsSkipped, GasTxType } from './gas'
export { compareCosts, DEFAULT_COMPARE_CHAINS, GAS_UNITS, getChainGasPriceGwei } from './gas'
import * as gas from './gas'
// Namespace handle so callers can use the documented `sdk.gas.compareCosts(...)`
// ergonomic alongside the flat named exports.
export { gas }

// Balance reads (per-chain, vault-free)
export type { GetUtxoBalanceOptions, UtxoBalance, UtxoBalanceChain } from './balance'
export { formatUtxoBalance, getUtxoBalance, supportedUtxoBalanceChains } from './balance'

// Balance reads (per-chain RPC)
export type { SolBalance, SplTokenBalance } from './balance'
export { getSolBalance, getSplTokenBalance } from './balance'

// Gas / fee primitives
export type { UtxoFeeRate } from './gas'
export { MAYACHAIN_NODE_URL, THORCHAIN_NODE_URL, utxoFeeRate } from './gas'

// Token utilities
export type {
  Coin,
  CoinKey,
  CoinMetadata,
  KnownCoin,
  KnownCoinMetadata,
  ResolveContractResult,
  TokenMetadataResolver,
  TokenStandard,
} from './token'
export { chainFeeCoin, getTokenMetadata, knownTokens, knownTokensIndex, resolveContract, searchToken } from './token'

// Balance reads for non-EVM, non-Cosmos chains (sui/ton/tron/xrp/cardano/tao)
export type {
  CardanoBalance,
  CardanoNativeToken,
  SuiAllBalancesResult,
  SuiBalance,
  SuiCoinBalance,
  SuiTokenBalance,
  TaoBalance,
  TonBalance,
  TonJettonBalance,
  Trc20TokenBalance,
  TronAccountResources,
  TrxBalance,
  XrpBalance,
} from './balance'
export {
  assertBittensorAddress,
  decodeBittensorAddress,
  getCardanoBalance,
  getSuiAllBalances,
  getSuiBalance,
  getSuiTokenBalance,
  getTaoBalance,
  getTonBalance,
  getTonJettonBalance,
  getTrc20TokenBalance,
  getTronAccountResources,
  getTrxBalance,
  getXrpBalance,
} from './balance'

// Price / fiat (token USD price via CoinGecko proxy)
export type { PriceBatchResult, PriceQuery, PriceQuote } from './price'
export {
  coinGeckoIdToSymbol,
  getPrice,
  getPricesBatch,
  isKnownNativePriceSymbol,
  NATIVE_COINGECKO_IDS,
  symbolFromCoinGeckoId,
} from './price'

// Cosmos governance (read proposals + build unsigned MsgVote envelope)
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
} from './cosmos'
export { getCosmosGovernanceProposals, prepareCosmosVote } from './cosmos'

// Swap
export type {
  AstroportSwapResult,
  BuildAstroportSwapParams,
  FindSwapQuoteParams,
  NativeSwapMinAmountIn,
  SkipChainIdsToAffiliates,
  SkipSwapArgs,
  SkipSwapErrorEnvelope,
  SkipSwapOutcome,
  SkipSwapSuccess,
  SkipUnsignedMsg,
  SwapQuote,
} from './swap'
export {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  buildSkipAffiliates,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  DEFAULT_LUNC_NOTIONAL_FLOOR_USD,
  findSwapQuote,
  getNativeSwapDecimals,
  getNativeSwapMinAmountIn,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
  quoteSkipRoute,
  resolveLuncFloorUsd,
  runSkipSwap,
  SKIP_AFFILIATE_ADDRESS_BY_CHAIN,
  SkipApiError,
  skipChainIdToChainName,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} from './swap'

// Gas / fee primitives (cosmos gas-fee label + gas limits)
export {
  COSMOS_SWAP_FEE_LABEL_CHAINS,
  COSMOS_SWAP_GAS_LIMIT,
  estimateCosmosSwapFeeLabel,
  getCosmosGasLimit,
  getCosmosSwapGasLimit,
} from './gas'

// DeFi protocol primitives (sdk.defi.*) — build UNSIGNED calldata/msgs only
export type {
  BalancerTokenApi,
  BalancerV3SwapCalldata,
  BalancerV3SwapKind,
  BalancerV3SwapPath,
  BuildBalancerV3SwapCalldataParams,
  BuildBuyPtParams,
  BuildGlifRedeemParams,
  BuildGlifRedeemResult,
  BuildGlifStakeParams,
  BuildGlifStakeResult,
  BuildRedeemParams,
  BuildSellPtParams,
  Defi,
  GlifUnsignedTx,
  PendleActiveMarket,
  PendleChain,
  PendleMarketParams,
  PendleMarketsParams,
  PendleMarketSummary,
  PendlePtBuildResult,
  PendleUnsignedTx,
} from './defi'
export {
  buildBalancerV3SwapCalldata,
  buildBuyPt,
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  buildRedeem,
  buildSellPt,
  defi,
  GLIF_ICN_BASE_ADDRESSES,
  GLIF_ICN_TOKEN_DECIMALS,
  glifPoolWriteAbi,
  isPendleChain,
  pendle,
  PENDLE_ROUTER_V4,
  PENDLE_SUPPORTED_CHAINS,
  PendleBuildError,
  pendleMarket,
  pendleMarkets,
  stripChainPrefix,
} from './defi'

// Verifier client
export type {
  BuildThreeJaneSupplyUsdcParams,
  BuildThreeJaneSupplyUsdcResult,
  ThreeJaneTranche,
  ThreeJaneTxStep,
} from './defi/threeJane'
export { VerifierClient } from './verifier'

// Pure intent↔envelope policy diff (vault-free comparison, no signing/broadcast)
export {
  AMOUNT_DRIFT_BLOCK_PCT,
  AMOUNT_DRIFT_WARN_PCT,
  amountDriftPct,
  type AmountUnits,
  chainAliasMap,
  chainsMatch,
  checkInvariants,
  claimInterpretations,
  evaluatePolicy,
  type FieldDiff,
  type IntentClaim,
  Invariant,
  type InvariantInput,
  type InvariantViolation,
  isZeroAmount,
  parseAmountBig,
  PLAUSIBLE_TOKEN_DECIMALS,
  policy,
  type AssetRef as PolicyAssetRef,
  type Envelope as PolicyEnvelope,
  ResultKind,
  sanitizeAmount,
  scaleDecimalClaimToAtomic,
  type Verdict,
} from './policy'

// Validation (pure recipient sanity: null / self-send / malformed-EVM)
export type { RecipientSanityFlag, RecipientSanityInput, RecipientSanityResult } from './validate'
export { isMalformedEvmAddress, isNullAddress, isSelfSend, recipientSanity } from './validate'

// Vault-free prep helpers (KeysignPayload construction without a full vault)
export {
  buildCw20TransferMsg,
  type BuildCw20TransferMsgParams,
  type BuildCw20TransferMsgResult,
  buildDelegateMsg,
  buildRedelegateMsg,
  buildSplTransfer,
  type BuildSplTransferParams,
  buildUndelegateMsg,
  buildWithdrawRewardsMsg,
  CONSOLIDATE_CHAINS,
  type ConsolidateChain,
  type ConsolidateUtxo,
  cosmosStaking,
  type CosmosStakingMsgEnvelope,
  type DelegateParams,
  getMaxSendAmountFromKeys,
  type GetMaxSendAmountFromKeysParams,
  IBC_CHAIN_HRP,
  IBC_CHAIN_REVISION,
  IBC_CHANNEL_DEST,
  IBC_MSG_TRANSFER_TYPE_URL,
  type IbcCosmosTx,
  type IbcMsgTransfer,
  normaliseIbcChainId,
  POLKADOT_ASSET_HUB_KNOWN_ASSETS,
  prepareContractCallTxFromKeys,
  prepareIbcTransfer,
  type PrepareIbcTransferParams,
  type PrepareIbcTransferResult,
  prepareJettonTransferTxFromKeys,
  type PrepareJettonTransferTxFromKeysParams,
  preparePolkadotAssetSend,
  type PreparePolkadotAssetSendParams,
  type PreparePolkadotAssetSendResult,
  prepareSendTxFromKeys,
  type PrepareSendTxFromKeysParams,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  prepareSuiTokenTransferFromKeys,
  type PrepareSuiTokenTransferFromKeysParams,
  prepareSwapTxFromKeys,
  type PrepareSwapTxFromKeysParams,
  prepareTrc20TransferFromKeys,
  type PrepareTrc20TransferFromKeysParams,
  type PrepareUtxoConsolidateResult,
  prepareUtxoConsolidateTxFromKeys,
  type PrepareUtxoConsolidateTxFromKeysParams,
  type RedelegateParams,
  type SplTransferResult,
  SUI_NATIVE_COIN_TYPE,
  supportedIbcDestinationsFrom,
  TRC20_TRANSFER_SELECTOR,
  type UndelegateParams,
  type UnsignedTrc20Transfer,
  type VaultIdentity,
  type WithdrawRewardsParams,
} from './prep'

// Atomic chain helpers (re-exported from core for vault-free callers)
export { getCoinBalance } from '@vultisig/core-chain/coin/balance'
export { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
export { getTxStatus } from '@vultisig/core-chain/tx/status'
