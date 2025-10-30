/**
 * Solana chain module
 *
 * After refactoring: Only exports the strategy and essential types.
 * All internal utilities (parsers, keysign, etc.) are now internal.
 *
 * Supports Jupiter V6 swaps, Raydium AMM swaps, SPL token transfers,
 * native SOL transfers, and v0 versioned transactions with Address Lookup Tables.
 *
 * @module chains/solana
 */

// Export the strategy (single entry point)
export { SolanaStrategy } from './SolanaStrategy'

// Export essential types (for TypeScript users)
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

// Everything else (parsers, config, keysign) is internal
// Internal code can still import them directly:
// import { parseSolanaTransaction } from './parsers/transaction'
// import { buildSolanaKeysignPayload } from './keysign'
// import { SOLANA_PROGRAM_IDS } from './config'
