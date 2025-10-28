/**
 * Solana chain module
 *
 * Provides transaction parsing and signing support for Solana blockchain.
 * Supports Jupiter V6 swaps, Raydium AMM swaps, SPL token transfers,
 * native SOL transfers, and v0 versioned transactions with Address Lookup Tables.
 *
 * @module chains/solana
 */

// Export types
export type {
  SolanaToken,
  PartialInstruction,
  AddressTableLookup,
  ParsedSolanaTransaction,
  ParsedSolanaSwapParams,
  SolanaTransactionInput,
  SolanaKeysignOptions,
  SolanaSignature,
} from './types'

// Export configuration
export {
  JUPITER_V6_PROGRAM_ID,
  RAYDIUM_AMM_PROGRAM_ID,
  SOLANA_PROGRAM_IDS,
} from './config'

// Export parsers
export {
  parseSolanaTransaction,
  resolveAddressTableKeys,
} from './parsers/transaction'

export { JupiterInstructionParser } from './parsers/jupiter'
export { RaydiumInstructionParser } from './parsers/raydium'

// Export keysign utilities
export {
  buildSolanaKeysignPayload,
  getSolanaSpecific,
  updateSolanaSpecific,
} from './keysign'
