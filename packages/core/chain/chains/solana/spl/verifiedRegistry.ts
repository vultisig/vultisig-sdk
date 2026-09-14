import { Chain } from '@vultisig/core-chain/Chain'
import { getJupiterVerifiedTokens } from '@vultisig/core-chain/coin/jupiter/api'
import { knownTokens } from '@vultisig/core-chain/coin/knownTokens'
import { normalizeTokenSymbol } from '@vultisig/core-chain/coin/tokenSymbol'
import { attempt } from '@vultisig/lib-utils/attempt'
import { memoizeAsync } from '@vultisig/lib-utils/memoizeAsync'
import { convertDuration } from '@vultisig/lib-utils/time/convertDuration'

/** A mint we treat as legitimate, keyed by its exact base58 address. */
export type VerifiedSolanaToken = {
  address: string
  symbol: string
  name?: string
  decimals?: number
  logo?: string
}

/**
 * Verified mints indexed for the two questions verification asks: "is this
 * mint listed?" and "does this symbol or name belong to a listed token?".
 * `symbols` and `names` hold `normalizeTokenSymbol` skeletons. Mints are
 * case-sensitive base58, so `byAddress` is keyed exactly.
 */
export type SolanaVerifiedTokenRegistry = {
  byAddress: Record<string, VerifiedSolanaToken>
  symbols: Set<string>
  names: Set<string>
}

/**
 * Builds a registry from a list of verified tokens. On a mint collision the
 * earlier entry's metadata is kept in `byAddress`, but every entry's symbol and
 * name are indexed: two entries for one mint describe the same verified token,
 * and a counterfeit may copy either spelling.
 */
export const makeSolanaVerifiedTokenRegistry = (tokens: VerifiedSolanaToken[]): SolanaVerifiedTokenRegistry => {
  const registry: SolanaVerifiedTokenRegistry = { byAddress: {}, symbols: new Set(), names: new Set() }

  for (const token of tokens) {
    registry.byAddress[token.address] ??= token

    const symbol = normalizeTokenSymbol(token.symbol)
    if (symbol) registry.symbols.add(symbol)

    const name = token.name ? normalizeTokenSymbol(token.name) : ''
    if (name) registry.names.add(name)
  }

  return registry
}

const getCuratedTokens = (): VerifiedSolanaToken[] =>
  knownTokens[Chain.Solana].flatMap(({ id, ticker, decimals, logo }) =>
    id ? [{ address: id, symbol: ticker, decimals, logo }] : []
  )

const fetchJupiterVerifiedTokens = async (): Promise<VerifiedSolanaToken[]> =>
  (await getJupiterVerifiedTokens()).flatMap(({ id, symbol, name, decimals, icon }) => {
    const ticker = symbol.trim()
    if (!ticker) return []

    return [
      {
        address: id,
        symbol: ticker,
        ...(name ? { name } : {}),
        ...(typeof decimals === 'number' ? { decimals } : {}),
        ...(icon ? { logo: icon } : {}),
      },
    ]
  })

// Only a successful fetch is cached: a rejected promise is never stored, so an
// outage is retried on the next call instead of pinning the degraded registry.
const getFullRegistry = memoizeAsync(
  async () => makeSolanaVerifiedTokenRegistry([...getCuratedTokens(), ...(await fetchJupiterVerifiedTokens())]),
  { cacheTime: convertDuration(1, 'h', 'ms') }
)

let curatedRegistry: SolanaVerifiedTokenRegistry | undefined

const getCuratedRegistry = (): SolanaVerifiedTokenRegistry => {
  if (!curatedRegistry) {
    curatedRegistry = makeSolanaVerifiedTokenRegistry(getCuratedTokens())
  }

  return curatedRegistry
}

/**
 * The mints we consider verified: our own curated Solana tokens (which win, so
 * their tickers and logos are kept) merged with Jupiter's verified list.
 * Degrades to the curated list alone when Jupiter cannot be fetched, so
 * discovery and labels keep working offline — with fewer tokens recognised.
 */
export const getSolanaVerifiedTokenRegistry = async (): Promise<SolanaVerifiedTokenRegistry> => {
  const result = await attempt(getFullRegistry())
  if ('data' in result && result.data) return result.data

  console.warn('[solana] verified token list unavailable; using the curated list only', result.error)

  return getCuratedRegistry()
}
