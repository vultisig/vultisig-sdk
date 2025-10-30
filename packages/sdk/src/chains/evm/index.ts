/**
 * EVM chain module
 *
 * After refactoring: Only exports the strategy and essential types.
 * All internal utilities (parsers, gas, tokens, etc.) are now internal.
 *
 * Supported chains:
 * - Ethereum
 * - Arbitrum, Base, Blast, Optimism, Zksync (L2s)
 * - Polygon, Avalanche, BSC, Cronos
 *
 * @module chains/evm
 */

// Export the strategy (single entry point)
export { EvmStrategy } from './EvmStrategy'

// Export essential types (for TypeScript users)
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

// Everything else (parsers, utilities, config) is internal
// Internal code can still import them directly:
// import { parseEvmTransaction } from './parsers/transaction'
// import { getChainId } from './config'
// import { estimateTransactionGas } from './gas/estimation'
