/**
 * Solana chain type definitions for transaction parsing and signing
 *
 * These types support:
 * - Jupiter V6 swaps
 * - Raydium AMM swaps
 * - SPL token transfers
 * - Native SOL transfers
 * - v0 versioned transactions with Address Lookup Tables (ALTs)
 */

/**
 * Token representation for Solana tokens (SPL tokens and native SOL)
 * Compatible with Jupiter token list format
 */
export interface SolanaToken {
  /** Token mint address (NATIVE_MINT for SOL) */
  address: string
  /** Token name (e.g., "Solana", "USD Coin") */
  name: string
  /** Token symbol (e.g., "SOL", "USDC") */
  symbol: string
  /** Number of decimal places */
  decimals: number
  /** Optional logo URI */
  logoURI?: string
}

/**
 * Partial instruction data from decoded Solana transaction
 * Used for parsing program-specific instructions
 */
export interface PartialInstruction {
  /** Index of the program ID in the account keys array */
  programId: number
  /** Raw program instruction data */
  programData: Uint8Array
  /** Array of account indices used by this instruction */
  accounts: number[]
}

/**
 * Address Lookup Table data for v0 versioned transactions
 * ALTs allow transactions to reference more accounts efficiently
 */
export interface AddressTableLookup {
  /** Public key of the lookup table account */
  accountKey: string
  /** Indices of writable accounts in the lookup table */
  writableIndexes: number[]
  /** Indices of readonly accounts in the lookup table */
  readonlyIndexes: number[]
}

/**
 * Parsed Solana transaction parameters
 * Result of parsing any supported Solana transaction type
 */
export interface ParsedSolanaTransaction {
  /** Transaction type identifier */
  type: 'swap' | 'transfer' | 'unknown'
  /** Authority/signer of the transaction */
  authority: string | undefined
  /** Input token being sent/swapped */
  inputToken: SolanaToken
  /** Output token being received (for swaps) */
  outputToken?: SolanaToken
  /** Input amount in token's smallest unit */
  inAmount: number
  /** Output amount in token's smallest unit (for swaps) */
  outAmount?: number
  /** Receiver address (for transfers) */
  receiverAddress?: string
  /** Protocol used (for swaps) */
  protocol?: 'jupiter' | 'raydium'
}

/**
 * Swap-specific parsed instruction parameters
 * Extracted from Jupiter or Raydium swap instructions
 */
export interface ParsedSolanaSwapParams {
  /** Authority/signer performing the swap */
  authority: string
  /** Input token mint address */
  inputMint: string
  /** Output token mint address */
  outputMint: string
  /** Input amount in token's smallest unit */
  inAmount: number
  /** Output amount in token's smallest unit */
  outAmount: number
}

/**
 * Solana transaction input format
 * Can be serialized bytes or a parsed transaction object
 */
export type SolanaTransactionInput =
  | { type: 'serialized'; data: Uint8Array }
  | { type: 'parsed'; transaction: ParsedSolanaTransaction }

/**
 * Keysign payload builder options for Solana
 */
export interface SolanaKeysignOptions {
  /** Parsed transaction data */
  parsedTransaction: ParsedSolanaTransaction
  /** Original serialized transaction */
  serializedTransaction: Uint8Array
  /** Vault public key (ECDSA) */
  vaultPublicKey: string
  /** Whether to skip broadcasting after signing */
  skipBroadcast?: boolean
}

/**
 * Solana signing result
 */
export interface SolanaSignature {
  /** Base58-encoded transaction signature */
  signature: string
  /** Transaction hash (if broadcasted) */
  txHash?: string
  /** Signed transaction bytes (if not broadcasted) */
  signedTransaction?: Uint8Array
}
