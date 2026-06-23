// Address derivation
export { deriveAddressFromKeys } from './address'

// EVM utilities
export { abiDecode, abiEncode, evmCall, evmCheckAllowance, evmTxInfo, resolve4ByteSelector, resolveEns } from './evm'

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

// Verifier client
export { VerifierClient } from './verifier'

// Validation (pure recipient sanity: null / self-send / malformed-EVM)
export type { RecipientSanityFlag, RecipientSanityInput, RecipientSanityResult } from './validate'
export { isMalformedEvmAddress, isNullAddress, isSelfSend, recipientSanity } from './validate'

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
