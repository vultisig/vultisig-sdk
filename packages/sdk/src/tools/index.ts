// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export { abiDecode, abiEncode, evmCall, evmCheckAllowance, evmTxInfo, resolve4ByteSelector, resolveEns } from './evm'

// Canonical bytes oracle (calldata -> chain-agnostic Envelope)
export type { AssetRef, ChainFamily, DecodeFromToolResultInput, Envelope, EnvelopeKind } from './decode'
export { decodeCosmosTx, decodeEvmTx, decodeFromToolResult } from './decode'

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

// DeFi protocol primitives (unsigned calldata builders) — sdk.defi.*
export type {
  BalancerTokenApi,
  BalancerV3SwapCalldata,
  BalancerV3SwapKind,
  BalancerV3SwapPath,
  BuildBalancerV3SwapCalldataParams,
  Defi,
} from './defi'
export { buildBalancerV3SwapCalldata, defi } from './defi'

// Verifier client
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
