/**
 * EVM gas pricing utilities
 *
 * Functions for formatting and converting gas prices between units
 */

import { FormattedGasPrice } from '../types'

/**
 * Format gas price from wei to multiple units
 *
 * @param wei - Gas price in wei
 * @returns Formatted gas price in wei, gwei, and eth
 */
export function formatGasPrice(wei: bigint): FormattedGasPrice {
  const weiNumber = Number(wei)

  return {
    wei: wei.toString(),
    gwei: (weiNumber / 1e9).toFixed(2),
    eth: (weiNumber / 1e18).toFixed(9),
  }
}

/**
 * Parse gas price from a value and unit to wei
 *
 * @param value - Numeric value
 * @param unit - Unit (wei, gwei, eth)
 * @returns Gas price in wei
 */
export function parseGasPrice(
  value: string | number,
  unit: 'wei' | 'gwei' | 'eth'
): bigint {
  const numValue = typeof value === 'string' ? parseFloat(value) : value

  switch (unit) {
    case 'wei':
      return BigInt(Math.floor(numValue))
    case 'gwei':
      return BigInt(Math.floor(numValue * 1e9))
    case 'eth':
      return BigInt(Math.floor(numValue * 1e18))
    default:
      throw new Error(`Unknown unit: ${unit}`)
  }
}

/**
 * Convert wei to gwei
 *
 * @param wei - Amount in wei
 * @returns Amount in gwei
 */
export function weiToGwei(wei: bigint): number {
  return Number(wei) / 1e9
}

/**
 * Convert gwei to wei
 *
 * @param gwei - Amount in gwei
 * @returns Amount in wei
 */
export function gweiToWei(gwei: number): bigint {
  return BigInt(Math.floor(gwei * 1e9))
}

/**
 * Convert wei to eth
 *
 * @param wei - Amount in wei
 * @returns Amount in eth
 */
export function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18
}

/**
 * Convert eth to wei
 *
 * @param eth - Amount in eth
 * @returns Amount in wei
 */
export function ethToWei(eth: number): bigint {
  return BigInt(Math.floor(eth * 1e18))
}

/**
 * Compare two gas prices
 *
 * @param price1 - First gas price in wei
 * @param price2 - Second gas price in wei
 * @returns Comparison result (-1 if price1 < price2, 0 if equal, 1 if price1 > price2)
 */
export function compareGasPrices(price1: bigint, price2: bigint): -1 | 0 | 1 {
  if (price1 < price2) return -1
  if (price1 > price2) return 1
  return 0
}

/**
 * Calculate gas price difference as percentage
 *
 * @param currentPrice - Current gas price in wei
 * @param previousPrice - Previous gas price in wei
 * @returns Percentage change (positive if increased, negative if decreased)
 */
export function calculateGasPriceChange(
  currentPrice: bigint,
  previousPrice: bigint
): number {
  const difference = Number(currentPrice - previousPrice)
  const percentage = (difference / Number(previousPrice)) * 100
  return percentage
}

/**
 * Format gas price for display with appropriate unit
 * Automatically selects the most readable unit
 *
 * @param wei - Gas price in wei
 * @returns Formatted string with unit
 */
export function formatGasPriceAuto(wei: bigint): string {
  const weiNumber = Number(wei)

  // Use gwei for most cases (most readable)
  if (weiNumber >= 1e9) {
    return `${(weiNumber / 1e9).toFixed(2)} gwei`
  }

  // Use wei for very small amounts
  if (weiNumber < 1e6) {
    return `${weiNumber} wei`
  }

  // Use mwei (million wei) for intermediate values
  return `${(weiNumber / 1e6).toFixed(2)} mwei`
}

/**
 * Get gas price category based on current network conditions
 *
 * @param gasPrice - Gas price in gwei
 * @returns Category (low, medium, high, very-high)
 */
export function getGasPriceCategory(
  gasPrice: number
): 'low' | 'medium' | 'high' | 'very-high' {
  if (gasPrice < 10) return 'low'
  if (gasPrice < 50) return 'medium'
  if (gasPrice < 150) return 'high'
  return 'very-high'
}
