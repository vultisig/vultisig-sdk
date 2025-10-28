/**
 * ERC-20 token utilities
 *
 * Wraps core ERC-20 functionality with user-friendly interfaces
 */

import { EvmChain } from '@core/chain/Chain'
import { getErc20Balance } from '@core/chain/chains/evm/erc20/getErc20Balance'
import { getErc20Allowance } from '@core/chain/chains/evm/erc20/getErc20Allowance'
import { formatUnits, parseUnits } from 'ethers'

/**
 * Get ERC-20 token balance for an account
 *
 * Wraps core's getErc20Balance with simplified interface.
 *
 * @param chain - EVM chain
 * @param tokenAddress - ERC-20 contract address
 * @param accountAddress - Account to check balance for
 * @returns Token balance in smallest unit
 */
export async function getTokenBalance(
  chain: EvmChain,
  tokenAddress: string,
  accountAddress: string
): Promise<bigint> {
  return getErc20Balance({
    chain,
    address: tokenAddress as `0x${string}`,
    accountAddress: accountAddress as `0x${string}`,
  })
}

/**
 * Get ERC-20 token allowance
 *
 * Returns the amount of tokens that spender is allowed to spend on behalf of owner.
 *
 * @param chain - EVM chain
 * @param tokenAddress - ERC-20 contract address
 * @param owner - Token owner address
 * @param spender - Spender address
 * @returns Allowance amount in smallest unit
 */
export async function getTokenAllowance(
  chain: EvmChain,
  tokenAddress: string,
  owner: string,
  spender: string
): Promise<bigint> {
  return getErc20Allowance({
    chain,
    address: tokenAddress as `0x${string}`,
    owner: owner as `0x${string}`,
    spender: spender as `0x${string}`,
  })
}

/**
 * Format token amount from smallest unit to human-readable
 *
 * @param amount - Amount in smallest unit (e.g., wei for 18 decimals)
 * @param decimals - Token decimals
 * @returns Formatted amount as string
 */
export function formatTokenAmount(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals)
}

/**
 * Parse human-readable token amount to smallest unit
 *
 * @param amount - Human-readable amount (e.g., "1.5")
 * @param decimals - Token decimals
 * @returns Amount in smallest unit
 */
export function parseTokenAmount(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals)
}

/**
 * Check if allowance is sufficient for an operation
 *
 * @param allowance - Current allowance
 * @param required - Required amount
 * @returns True if allowance is sufficient
 */
export function isAllowanceSufficient(
  allowance: bigint,
  required: bigint
): boolean {
  return allowance >= required
}

/**
 * Calculate the difference needed to reach required allowance
 *
 * @param current - Current allowance
 * @param required - Required allowance
 * @returns Additional allowance needed (0 if sufficient)
 */
export function calculateAllowanceShortfall(
  current: bigint,
  required: bigint
): bigint {
  if (current >= required) {
    return 0n
  }
  return required - current
}

/**
 * Format token balance with symbol
 *
 * @param amount - Amount in smallest unit
 * @param decimals - Token decimals
 * @param symbol - Token symbol
 * @param maxDecimals - Maximum decimal places to show (default: decimals)
 * @returns Formatted string like "1.50 USDC"
 */
export function formatTokenWithSymbol(
  amount: bigint,
  decimals: number,
  symbol: string,
  maxDecimals?: number
): string {
  const formatted = formatTokenAmount(amount, decimals)
  const displayDecimals = maxDecimals ?? decimals

  // Truncate to maxDecimals
  const [whole, fraction = ''] = formatted.split('.')
  const truncatedFraction = fraction.slice(0, displayDecimals)
  const finalAmount =
    truncatedFraction.length > 0 ? `${whole}.${truncatedFraction}` : whole

  return `${finalAmount} ${symbol}`
}

/**
 * Compare two token amounts
 *
 * @param amount1 - First amount
 * @param amount2 - Second amount
 * @returns Comparison result (-1 if amount1 < amount2, 0 if equal, 1 if amount1 > amount2)
 */
export function compareAmounts(amount1: bigint, amount2: bigint): -1 | 0 | 1 {
  if (amount1 < amount2) return -1
  if (amount1 > amount2) return 1
  return 0
}
