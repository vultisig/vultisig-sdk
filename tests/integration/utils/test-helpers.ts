import type { Vault } from '../../../src/vault/Vault';
import type { Chain } from '../../../src/core/chain/Chain';
import { MOCK_PRICES, usdToNative } from '../config/test-config';

/**
 * Check if vault has sufficient balance for a test
 */
export async function checkSufficientBalance(
  vault: Vault,
  chain: Chain,
  requiredAmountNative: number,
  tokenSymbol: keyof typeof MOCK_PRICES
): Promise<{ sufficient: boolean; currentBalance: string; required: string }> {
  try {
    const balance = await vault.balance(chain);

    // Parse balance (assuming it's returned as a string)
    const balanceNum = parseFloat(balance.toString());

    const sufficient = balanceNum >= requiredAmountNative;

    return {
      sufficient,
      currentBalance: balanceNum.toFixed(6),
      required: requiredAmountNative.toFixed(6),
    };
  } catch (error) {
    console.error('Error checking balance:', error);
    return {
      sufficient: false,
      currentBalance: '0',
      required: requiredAmountNative.toFixed(6),
    };
  }
}

/**
 * Convert USD amount to native token amount with decimals
 */
export function convertUsdToNative(
  usdAmount: number,
  tokenSymbol: keyof typeof MOCK_PRICES,
  decimals: number = 9 // Default to Solana's 9 decimals
): {
  native: number;
  lamports: bigint;
  formatted: string;
} {
  const native = usdToNative(usdAmount, tokenSymbol);
  const lamports = BigInt(Math.floor(native * Math.pow(10, decimals)));

  return {
    native,
    lamports,
    formatted: `${native.toFixed(6)} ${tokenSymbol}`,
  };
}

/**
 * Format balance for display
 */
export function formatBalance(
  amount: number | string | bigint,
  symbol: string,
  decimals: number = 9
): string {
  let num: number;

  if (typeof amount === 'bigint') {
    num = Number(amount) / Math.pow(10, decimals);
  } else if (typeof amount === 'string') {
    num = parseFloat(amount);
  } else {
    num = amount;
  }

  return `${num.toFixed(6)} ${symbol}`;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 * Note: Current plan specifies no retries, but keeping this for future use
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    backoffMultiplier?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, delayMs = 1000, backoffMultiplier = 2 } = options;

  let lastError: Error;
  let currentDelay = delayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxAttempts) {
        console.log(
          `Attempt ${attempt} failed, retrying in ${currentDelay}ms...`
        );
        await sleep(currentDelay);
        currentDelay *= backoffMultiplier;
      }
    }
  }

  throw lastError!;
}

/**
 * Validate address format for a given chain
 */
export function isValidAddress(address: string, chain: Chain): boolean {
  // Basic validation - can be expanded with chain-specific rules
  if (!address || address.length === 0) {
    return false;
  }

  // Chain-specific validation
  switch (chain) {
    case 'Solana':
      // Solana addresses are base58 encoded and typically 32-44 characters
      return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);

    case 'Ethereum':
    case 'Polygon':
    case 'Avalanche':
    case 'BSC':
    case 'Arbitrum':
    case 'Optimism':
    case 'Base':
      // EVM addresses start with 0x and are 42 characters long
      return /^0x[a-fA-F0-9]{40}$/.test(address);

    case 'Bitcoin':
    case 'BitcoinCash':
    case 'Litecoin':
    case 'Dogecoin':
      // UTXO addresses vary, basic length check
      return address.length >= 26 && address.length <= 62;

    default:
      // For unknown chains, just check it's not empty
      return true;
  }
}

/**
 * Get chain-specific decimals
 */
export function getChainDecimals(chain: Chain): number {
  switch (chain) {
    case 'Solana':
      return 9;
    case 'Ethereum':
    case 'Polygon':
    case 'Avalanche':
    case 'BSC':
    case 'Arbitrum':
    case 'Optimism':
    case 'Base':
      return 18;
    case 'Bitcoin':
    case 'BitcoinCash':
    case 'Litecoin':
    case 'Dogecoin':
      return 8;
    default:
      return 9; // Default
  }
}

/**
 * Assert test preconditions
 */
export class TestAssertions {
  static assertVault(vault: Vault | null | undefined): asserts vault is Vault {
    if (!vault) {
      throw new Error('Vault is null or undefined');
    }
  }

  static assertAddress(address: string | null | undefined, chain: Chain): asserts address is string {
    if (!address) {
      throw new Error(`Address is null or undefined for chain ${chain}`);
    }
    if (!isValidAddress(address, chain)) {
      throw new Error(`Invalid address format for chain ${chain}: ${address}`);
    }
  }

  static assertSufficientBalance(
    balanceCheck: { sufficient: boolean; currentBalance: string; required: string },
    tokenSymbol: string
  ): void {
    if (!balanceCheck.sufficient) {
      throw new Error(
        `Insufficient balance. Required: ${balanceCheck.required} ${tokenSymbol}, ` +
        `Available: ${balanceCheck.currentBalance} ${tokenSymbol}. ` +
        `Please fund the test vault.`
      );
    }
  }
}
