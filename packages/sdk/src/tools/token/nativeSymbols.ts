import { Chain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'

const nativeSymbolAliases: Partial<Record<Chain, readonly string[]>> = {
  [Chain.Ton]: ['TON'],
  [Chain.Polygon]: ['MATIC'],
}

const displaySymbols: Partial<Record<Chain, string>> = {
  [Chain.Ton]: 'TON',
  [Chain.Polygon]: 'POL',
}

const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase()

/** Display ticker for a chain's native coin; fee metadata remains unchanged. */
export const getNativeDisplaySymbol = (chain: Chain): string => displaySymbols[chain] ?? chainFeeCoin[chain].ticker

/** Match only a chain's native ticker or known aliases, never a token contract. */
export const isNativeTickerForChain = (chain: Chain, symbol: string): boolean => {
  const normalized = normalizeSymbol(symbol)
  if (!normalized) return false

  return (
    normalized === normalizeSymbol(chainFeeCoin[chain].ticker) ||
    (nativeSymbolAliases[chain]?.includes(normalized) ?? false)
  )
}

/** Resolve a native ticker only when exactly one chain matches it. */
export const nativeChainForTicker = (symbol: string): Chain | undefined => {
  const normalized = normalizeSymbol(symbol)
  if (!normalized) return undefined

  let match: Chain | undefined
  for (const chain of Object.keys(chainFeeCoin) as Chain[]) {
    if (!isNativeTickerForChain(chain, normalized)) continue
    if (match !== undefined) return undefined
    match = chain
  }
  return match
}

/** Same conservative lookup as nativeChainForTicker; ambiguous tickers return undefined. */
export const unambiguousNativeChainForTicker = nativeChainForTicker
