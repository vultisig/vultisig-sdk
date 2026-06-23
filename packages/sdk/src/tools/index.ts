// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export { abiDecode, abiEncode, evmCall, evmCheckAllowance, evmTxInfo, resolve4ByteSelector, resolveEns } from './evm'

// Token utilities
export type { Coin, CoinKey, CoinMetadata, KnownCoin, KnownCoinMetadata, TokenMetadataResolver } from './token'
export { chainFeeCoin, getTokenMetadata, knownTokens, knownTokensIndex, searchToken } from './token'

// Swap
export type {
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
  buildSkipAffiliates,
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
} from './swap'

// Verifier client
export { VerifierClient } from './verifier'

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
