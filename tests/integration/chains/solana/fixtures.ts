/**
 * Solana Test Fixtures
 *
 * Test data and constants for Solana integration tests
 */

/**
 * Well-known Solana program IDs for reference
 */
export const SOLANA_PROGRAMS = {
  SYSTEM: '11111111111111111111111111111111',
  TOKEN: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  ASSOCIATED_TOKEN: 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
  JUPITER_V6: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  RAYDIUM_AMM: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
} as const;

/**
 * Sample SPL token addresses for testing
 * These are well-known mainnet tokens
 */
export const TEST_TOKENS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  USDT: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  SOL_WRAPPED: 'So11111111111111111111111111111111111111112',
} as const;

/**
 * Solana network endpoints
 */
export const SOLANA_ENDPOINTS = {
  MAINNET: 'https://api.mainnet-beta.solana.com',
  DEVNET: 'https://api.devnet.solana.com',
  TESTNET: 'https://api.testnet.solana.com',
} as const;

/**
 * Explorer URLs for different Solana networks
 */
export function getSolanaExplorerUrl(txHash: string, network: 'mainnet' | 'devnet' | 'testnet' = 'mainnet'): string {
  const cluster = network === 'mainnet' ? '' : `?cluster=${network}`;
  return `https://solscan.io/tx/${txHash}${cluster}`;
}

/**
 * Default priority fees in microlamports
 */
export const DEFAULT_PRIORITY_FEE = 5000; // 0.000005 SOL

/**
 * Minimum SOL balance to maintain in wallet (for rent + fees)
 */
export const MIN_SOL_BALANCE = 0.01; // SOL

/**
 * Test transaction configurations
 */
export const TEST_TX_CONFIG = {
  // Maximum time to wait for transaction confirmation (ms)
  CONFIRMATION_TIMEOUT: 60000,

  // Number of confirmations to wait for
  CONFIRMATIONS: 1,

  // Commitment level for transactions
  COMMITMENT: 'confirmed' as const,
} as const;
