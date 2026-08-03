import { Coin } from '../Coin'

type FindByTickerInput<T extends Coin> = {
  coins: T[]
  ticker: string
}

// SDK2-02 (audit r2): a bare ticker like "USDC" exists on many chains (Ethereum/Polygon/Arbitrum/Base/…).
// The old `coins.find(c => c.ticker === ticker)` returned the ARRAY-ORDER first match — if this ever got
// wired into a fund path, "USDC" would silently resolve to whichever chain happened to be first, sending to
// the wrong network. Refuse to guess: return the unique match (or null when absent), and THROW when the
// ticker is ambiguous across more than one chain so the caller must disambiguate by chain.
export const findByTicker = <T extends Coin>({ coins, ticker }: FindByTickerInput<T>): T | null => {
  const matches = coins.filter(c => c.ticker === ticker)
  if (matches.length === 0) return null
  const chains = new Set(matches.map(c => c.chain))
  if (chains.size > 1) {
    throw new Error(
      `findByTicker: ticker "${ticker}" is ambiguous across ${chains.size} chains (${[...chains].join(', ')}); pass a chain-scoped lookup instead of a bare ticker`
    )
  }
  return matches[0] ?? null
}
