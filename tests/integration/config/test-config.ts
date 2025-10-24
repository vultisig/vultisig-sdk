/**
 * Integration Test Configuration
 *
 * This file contains all configuration for integration tests including
 * test amounts, RPC endpoints, and recipient addresses.
 */

export interface ChainConfig {
  rpcEndpoint?: string;
  testAmountUsd: number;
  explorerTxUrl: (hash: string) => string;
}

export interface TestConfig {
  // Global settings
  dryRun: boolean;
  vaultPassword: string;

  // Chain-specific configurations
  chains: {
    solana: ChainConfig & {
      recipientAddress: string;
      priorityFee?: string;
    };
    // Future chains can be added here
    // ethereum: ChainConfig & { recipientAddress: string };
    // bitcoin: ChainConfig & { recipientAddress: string };
  };
}

/**
 * Load test configuration from environment variables
 */
export function loadTestConfig(): TestConfig {
  const vaultPassword = process.env.VAULT_PASSWORD;
  if (!vaultPassword) {
    throw new Error('VAULT_PASSWORD environment variable is required');
  }

  return {
    // Global settings
    dryRun: process.env.DRY_RUN === 'true',
    vaultPassword,

    // Chain configurations
    chains: {
      solana: {
        rpcEndpoint:
          process.env.SOLANA_RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com',
        testAmountUsd: 0.5, // $0.50 per test
        recipientAddress:
          process.env.TEST_RECIPIENT_SOL ||
          '', // Must be set in .env or will use same vault address (self-transfer)
        priorityFee: process.env.SOLANA_PRIORITY_FEE || '5000', // microlamports
        explorerTxUrl: (hash: string) => `https://solscan.io/tx/${hash}`,
      },
    },
  };
}

/**
 * Get price feeds for converting USD to native amounts
 * In a real implementation, you might fetch from CoinGecko or similar
 */
export const MOCK_PRICES = {
  SOL: 140, // $140 per SOL (update manually or fetch dynamically)
  ETH: 2500,
  BTC: 45000,
  AVAX: 35,
  MATIC: 0.8,
  BNB: 300,
  // Add more as needed
};

/**
 * Convert USD amount to native token amount
 */
export function usdToNative(usdAmount: number, tokenSymbol: keyof typeof MOCK_PRICES): number {
  const price = MOCK_PRICES[tokenSymbol];
  if (!price) {
    throw new Error(`No price found for ${tokenSymbol}`);
  }
  return usdAmount / price;
}
