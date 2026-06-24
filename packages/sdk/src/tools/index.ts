// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export { abiDecode, abiEncode, evmCall, evmCheckAllowance, evmTxInfo, resolve4ByteSelector, resolveEns } from './evm'

// Canonical bytes oracle (calldata -> chain-agnostic Envelope)
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './decode'
export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult } from './decode'

// DEX primitives (read-only / pure math — no signing, no broadcast)
export * as dex from './dex'

// Token utilities
export type { Coin, CoinKey, CoinMetadata, KnownCoin, KnownCoinMetadata, TokenMetadataResolver } from './token'
export { chainFeeCoin, getTokenMetadata, knownTokens, knownTokensIndex, searchToken } from './token'

// Swap
export type { FindSwapQuoteParams, NativeSwapMinAmountIn, SwapQuote } from './swap'
export {
  findSwapQuote,
  getNativeSwapDecimals,
  getNativeSwapMinAmountIn,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
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

// Vault-free prep helpers (KeysignPayload construction without a full vault)
export {
  getMaxSendAmountFromKeys,
  type GetMaxSendAmountFromKeysParams,
  prepareContractCallTxFromKeys,
  prepareSendTxFromKeys,
  type PrepareSendTxFromKeysParams,
  prepareSignAminoTxFromKeys,
  prepareSignDirectTxFromKeys,
  prepareSwapTxFromKeys,
  type PrepareSwapTxFromKeysParams,
  type VaultIdentity,
} from './prep'

// Atomic chain helpers (re-exported from core for vault-free callers)
export { getCoinBalance } from '@vultisig/core-chain/coin/balance'
export { getPublicKey } from '@vultisig/core-chain/publicKey/getPublicKey'
export { getTxStatus } from '@vultisig/core-chain/tx/status'
