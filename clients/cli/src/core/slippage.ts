import { InvalidInputError } from './errors'

export function parseSlippagePercent(raw: string): number {
  const slippage = Number(raw)
  if (!Number.isFinite(slippage) || slippage < 0 || slippage > 50) {
    throw new InvalidInputError(`Invalid --slippage: "${raw}"; expected a percentage from 0 to 50`)
  }
  return slippage
}
