import { parseUnits } from 'viem'

export const toChainAmount = (amount: string | number, decimals: number) => {
  if (typeof amount === 'string') {
    const trimmed = amount.trim()
    if (!trimmed) {
      throw new Error('Amount cannot be empty')
    }
    return parseUnits(trimmed, decimals)
  }
  const str = amount.toString()
  const value = /[eE]/.test(str) ? amount.toFixed(decimals) : str
  return parseUnits(value, decimals)
}
