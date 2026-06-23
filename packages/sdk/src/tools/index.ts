// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export { abiDecode, abiEncode, evmCall, evmCheckAllowance, evmTxInfo, resolve4ByteSelector, resolveEns } from './evm'

// Token utilities
export type { Coin, CoinKey, CoinMetadata, KnownCoin, KnownCoinMetadata, TokenMetadataResolver } from './token'
export { chainFeeCoin, getTokenMetadata, knownTokens, knownTokensIndex, searchToken } from './token'

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

// Swap
export type { FindSwapQuoteParams, NativeSwapMinAmountIn, SwapQuote } from './swap'
export {
  findSwapQuote,
  getNativeSwapDecimals,
  getNativeSwapMinAmountIn,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
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
