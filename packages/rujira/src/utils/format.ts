/**
 * Formatting utilities for Rujira SDK
 * @module utils/format
 */

import { getAssetInfo } from '../config';
import type { SwapRequest } from '../types';

/**
 * Convert human-readable amount to base units
 * 
 * @param amount - Human readable amount (e.g., "1.5")
 * @param decimals - Number of decimals
 * @returns Base units as string
 * 
 * @example
 * ```typescript
 * toBaseUnits("1.5", 8); // "150000000"
 * toBaseUnits("0.001", 18); // "1000000000000000"
 * ```
 */
export function toBaseUnits(amount: string | number, decimals: number): string {
  const amountStr = amount.toString();
  const [whole, fraction = ''] = amountStr.split('.');
  
  // Pad or truncate fraction to match decimals
  const paddedFraction = fraction.padEnd(decimals, '0').slice(0, decimals);
  
  // Combine and remove leading zeros
  const result = `${whole}${paddedFraction}`.replace(/^0+/, '') || '0';
  
  return result;
}

/**
 * Convert base units to human-readable amount
 * 
 * @param baseUnits - Amount in base units
 * @param decimals - Number of decimals
 * @returns Human readable amount
 * 
 * @example
 * ```typescript
 * fromBaseUnits("150000000", 8); // "1.5"
 * fromBaseUnits("1000000000000000", 18); // "0.001"
 * ```
 */
export function fromBaseUnits(baseUnits: string | bigint, decimals: number): string {
  const str = baseUnits.toString().padStart(decimals + 1, '0');
  const whole = str.slice(0, -decimals) || '0';
  const fraction = str.slice(-decimals).replace(/0+$/, '');
  
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Format amount for display
 * 
 * @param baseUnits - Amount in base units
 * @param asset - Asset identifier
 * @param maxDecimals - Maximum decimal places to show
 */
export function formatAmount(
  baseUnits: string | bigint,
  asset: string,
  maxDecimals = 6
): string {
  const info = getAssetInfo(asset);
  if (!info) {
    return baseUnits.toString();
  }
  
  const human = fromBaseUnits(baseUnits, info.decimals);
  const parts = human.split('.');
  const whole = parts[0] || '0';
  const fraction = parts[1] || '';
  
  // Truncate to maxDecimals
  const truncatedFraction = fraction.slice(0, maxDecimals);
  
  // Add thousand separators to whole part
  const formattedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  
  return truncatedFraction 
    ? `${formattedWhole}.${truncatedFraction}`
    : formattedWhole;
}

/**
 * Parse amount from user input
 * 
 * @param input - User input string
 * @param asset - Asset identifier
 * @returns Base units
 */
export function parseAmount(input: string, asset: string): string {
  const info = getAssetInfo(asset);
  if (!info) {
    throw new Error(`Unknown asset: ${asset}`);
  }
  
  // Remove commas and whitespace
  const cleaned = input.replace(/[,\s]/g, '');
  
  return toBaseUnits(cleaned, info.decimals);
}

/**
 * Calculate minimum return after slippage
 * 
 * @param expectedOutput - Expected output in base units
 * @param slippageBps - Slippage tolerance in basis points
 * @returns Minimum acceptable output
 */
export function calculateMinReturn(
  expectedOutput: string | bigint,
  slippageBps: number
): string {
  const expected = BigInt(expectedOutput);
  const slippageAmount = (expected * BigInt(slippageBps)) / 10000n;
  return (expected - slippageAmount).toString();
}

/**
 * Calculate slippage percentage from expected vs actual
 * 
 * @param expected - Expected amount
 * @param actual - Actual amount received
 * @returns Slippage percentage (negative if worse than expected)
 */
export function calculateSlippage(expected: string | bigint, actual: string | bigint): string {
  const exp = BigInt(expected);
  const act = BigInt(actual);
  
  if (exp === 0n) return '0';
  
  const diff = act - exp;
  const percentage = (diff * 10000n) / exp;
  
  return (Number(percentage) / 100).toFixed(2);
}

/**
 * Generate a unique quote ID
 */
export function generateQuoteId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `quote-${timestamp}-${random}`;
}

/**
 * Build a swap message from parameters
 * 
 * @param minReturn - Minimum return amount
 * @param to - Destination address (optional)
 */
export function buildSwapMsg(
  minReturn: string,
  to?: string
): { swap: SwapRequest } {
  return {
    swap: {
      min: {
        min_return: minReturn,
        to,
      }
    }
  };
}

/**
 * Truncate string in the middle (for addresses)
 * 
 * @param str - String to truncate
 * @param startChars - Characters to show at start
 * @param endChars - Characters to show at end
 */
export function truncateMiddle(
  str: string,
  startChars = 8,
  endChars = 6
): string {
  if (str.length <= startChars + endChars) {
    return str;
  }
  return `${str.slice(0, startChars)}...${str.slice(-endChars)}`;
}

/**
 * Format percentage for display
 * 
 * @param value - Decimal value (e.g., 0.015 for 1.5%)
 * @param decimals - Decimal places to show
 */
export function formatPercentage(value: number | string, decimals = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return `${(num * 100).toFixed(decimals)}%`;
}

/**
 * Format basis points as percentage
 * 
 * @param bps - Basis points
 */
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/**
 * Convert percentage to basis points
 * 
 * @param percent - Percentage (e.g., 1.5 for 1.5%)
 */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}
