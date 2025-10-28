/**
 * EVM chain module
 *
 * Provides transaction parsing and signing support for EVM-compatible blockchains.
 * Supports native transfers, ERC-20 tokens, Uniswap/1inch swaps, NFT transfers,
 * and generic contract interactions.
 *
 * Supported chains:
 * - Ethereum
 * - Arbitrum, Base, Blast, Optimism, Zksync (L2s)
 * - Polygon, Avalanche, BSC, Cronos
 *
 * @module chains/evm
 */

// Export types
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
  FormattedGasPrice,
} from './types'

// Export configuration
export {
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
} from './config'

// Export parsers
export {
  parseEvmTransaction,
  parseErc20TransferFrom,
  getFunctionSelector,
} from './parsers/transaction'
export { Erc20Parser } from './parsers/erc20'
export { UniswapParser } from './parsers/uniswap'
export { OneInchParser } from './parsers/1inch'
export { NftParser } from './parsers/nft'

// Export keysign utilities
export {
  buildEvmKeysignPayload,
  getEvmSpecific,
  updateEvmSpecific,
} from './keysign'

// Export gas utilities
export {
  estimateTransactionGas,
  calculateMaxGasCost,
  calculateExpectedGasCost,
  compareGasEstimates,
} from './gas/estimation'
export {
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
} from './gas/pricing'

// Export token utilities
export {
  getTokenBalance,
  getTokenAllowance,
  formatTokenAmount,
  parseTokenAmount,
  isAllowanceSufficient,
  calculateAllowanceShortfall,
  formatTokenWithSymbol,
  compareAmounts,
} from './tokens/erc20'
export {
  getTokenMetadata,
  buildToken,
  getNativeToken,
  batchGetTokenMetadata,
  isValidTokenAddress,
  normalizeTokenAddress,
} from './tokens/metadata'
