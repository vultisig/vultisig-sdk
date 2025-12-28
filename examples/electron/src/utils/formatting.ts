/**
 * Shorten an address or ID for display
 */
export function shortenAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) {
    return address
  }
  return `${address.slice(0, chars)}...${address.slice(-chars)}`
}

/**
 * Format a balance value for display
 */
export function formatBalance(amount: string, decimals: number = 8): string {
  const num = parseFloat(amount)
  if (isNaN(num)) return '0'
  if (num === 0) return '0'
  if (num < 0.0001) return '<0.0001'
  return num.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}
