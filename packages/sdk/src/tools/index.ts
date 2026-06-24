// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export type { GetTokenApprovalsResult, TokenApproval } from './evm'
export {
  abiDecode,
  abiEncode,
  evmCall,
  evmCheckAllowance,
  evmTxInfo,
  getTokenApprovals,
  resolve4ByteSelector,
  resolveEns,
} from './evm'

// Canonical bytes oracle (calldata -> chain-agnostic Envelope)
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './decode'
export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult } from './decode'

// DEX primitives (read-only / pure math + on-chain quotes — no signing, no broadcast)
export * as dex from './dex'

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
  SwapQuote,
} from './swap'
export {
  assembleAstroportSwap,
  ASTROPORT_ROUTER,
  buildAstroportSwap,
  classifyAstroportAsset,
  computeAstroportMinReceive,
  findSwapQuote,
  getNativeSwapDecimals,
  getNativeSwapMinAmountIn,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
  TERRA_CHAIN_ID,
  TERRA_LCD,
} from './swap'

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
  buildSplTransfer,
  type BuildSplTransferParams,
  CONSOLIDATE_CHAINS,
  type ConsolidateChain,
  type ConsolidateUtxo,
  getMaxSendAmountFromKeys,
  type GetMaxSendAmountFromKeysParams,
  prepareContractCallTxFromKeys,
  prepareSendTxFromKeys,
  type PrepareSendTxFromKeysParams,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  prepareSuiTokenTransferFromKeys,
  type PrepareSuiTokenTransferFromKeysParams,
  prepareSwapTxFromKeys,
  type PrepareSwapTxFromKeysParams,
  type PrepareUtxoConsolidateResult,
  prepareUtxoConsolidateTxFromKeys,
  type PrepareUtxoConsolidateTxFromKeysParams,
  type SplTransferResult,
  SUI_NATIVE_COIN_TYPE,
  type VaultIdentity,
} from './prep'

// Atomic chain helpers (re-exported from core for vault-free callers)
export { getCoinBalance } from '@vultisig/core-chain/coin/balance'
export { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
export { getTxStatus } from '@vultisig/core-chain/tx/status'
