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
  JupiterQuoteResponse,
  JupiterSwapParams,
  JupiterSwapResult,
  NativeSwapMinAmountIn,
  SwapQuote,
} from './swap'
export {
  buildJupiterSwapTx,
  findSwapQuote,
  getNativeSwapDecimals,
  getNativeSwapMinAmountIn,
  JUPITER_AFFILIATE_FEE_ATAS,
  JUPITER_AFFILIATE_FEE_OWNER,
  JUPITER_API_BASE_URL,
  JUPITER_DEFAULT_SLIPPAGE_BPS,
  JUPITER_PLATFORM_FEE_BPS,
  NATIVE_SWAP_MIN_OUTBOUND_FEE_MULTIPLIER,
  resolveJupiterFeeAccount,
  SOL_NATIVE_MINT,
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
