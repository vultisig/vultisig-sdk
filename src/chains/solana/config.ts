import { address, type Address } from '@solana/web3.js'

/**
 * Solana program IDs for transaction parsing
 * These are used to identify different types of transactions
 */

/**
 * Jupiter V6 Program ID
 * Used for identifying Jupiter swap transactions
 */
export const JUPITER_V6_PROGRAM_ID: Address = address(
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
)

/**
 * Raydium AMM Routing Program ID
 * Used for identifying Raydium swap transactions
 */
export const RAYDIUM_AMM_PROGRAM_ID: Address = address(
  'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS'
)

/**
 * Program ID map for easy lookup
 */
export const SOLANA_PROGRAM_IDS = {
  JUPITER_V6: JUPITER_V6_PROGRAM_ID,
  RAYDIUM_AMM: RAYDIUM_AMM_PROGRAM_ID,
} as const
