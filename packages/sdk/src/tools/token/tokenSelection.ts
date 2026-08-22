import type { TokenSearchResult } from './searchToken'

const evmAddressRE = /^0x[0-9a-fA-F]{40}$/
const solanaAddressRE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const tronAddressRE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const ibcDenomRE = /^ibc\/[0-9a-fA-F]{64}$/

export type TokenDeploymentLike = {
  chain: string
  contractAddress: string
  decimals?: number
}

export type TokenSearchResultLike = {
  id: string
  name: string
  symbol: string
  marketCapRank: number | null
  deployments: TokenDeploymentLike[]
}

export type TokenMatch = {
  source: 'coingecko_search' | 'known'
  coingecko_order: number
  matched_symbol_exactly: boolean
  matched_name_exactly: boolean
  matched_id_exactly: boolean
  market_cap_rank: number | null
}

export type TokenCandidate = {
  order: number
  coingeckoId: string
  name: string
  symbol: string
  marketCapRank: number | null
  deployments: TokenDeploymentLike[]
  match: TokenMatch
}

export type ResolvedTokenIdentity = {
  symbol: string
  name: string
  coingeckoId: string
  decimals?: number
}

export type TokenInputKind = 'evm_contract' | 'solana_mint' | 'tron_contract' | 'cosmos_ibc' | 'native_or_symbol'

function eqQuery(query: string, value: string): boolean {
  return query.trim().toLowerCase() === value.trim().toLowerCase()
}

/**
 * Classify a token query string so callers can route contract/mint/IBC
 * lookups separately from CoinGecko symbol search.
 */
export function classifyTokenInput(token: string, chain?: string): TokenInputKind {
  if (evmAddressRE.test(token)) return 'evm_contract'
  if (chain === 'Solana' && solanaAddressRE.test(token)) return 'solana_mint'
  if (chain === 'Tron' && tronAddressRE.test(token)) return 'tron_contract'
  if (ibcDenomRE.test(token)) return 'cosmos_ibc'
  return 'native_or_symbol'
}

/**
 * Normalize raw `searchToken()` results into ordered candidates with
 * exact-match flags. Optional `chain` drops candidates with no deployment
 * on that chain.
 */
export function normalizeTokenCandidates(
  query: string,
  results: readonly TokenSearchResultLike[] | readonly TokenSearchResult[],
  chain?: string
): TokenCandidate[] {
  return results
    .map((result, index) => {
      const deployments = chain ? result.deployments.filter(d => d.chain === chain) : result.deployments
      return {
        order: index + 1,
        coingeckoId: result.id,
        name: result.name,
        symbol: result.symbol.toUpperCase(),
        marketCapRank: result.marketCapRank,
        deployments,
        match: {
          source: 'coingecko_search' as const,
          coingecko_order: index + 1,
          matched_symbol_exactly: eqQuery(query, result.symbol),
          matched_name_exactly: eqQuery(query, result.name),
          matched_id_exactly: eqQuery(query, result.id),
          market_cap_rank: result.marketCapRank,
        },
      }
    })
    .filter(candidate => !chain || candidate.deployments.length > 0)
}

/**
 * Pick a clear winner from normalized candidates. Ambiguous sets return
 * undefined so the caller can prompt instead of guessing.
 */
export function pickClearTokenCandidate(candidates: readonly TokenCandidate[]): TokenCandidate | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const exactId = candidates.filter(c => c.match.matched_id_exactly)
  if (exactId.length === 1 && exactId[0].order === 1) return exactId[0]

  const exactSymbol = candidates.filter(c => c.match.matched_symbol_exactly)
  if (exactSymbol.length === 1 && exactSymbol[0].order <= 2) return exactSymbol[0]

  const exactName = candidates.filter(c => c.match.matched_name_exactly)
  if (exactName.length === 1 && exactName[0].order <= 3) return exactName[0]

  return undefined
}

/**
 * Look up a contract/mint in search results. EVM matching is
 * case-insensitive; Solana matching is case-sensitive.
 */
export function findContractIdentity(
  token: string,
  results: readonly TokenSearchResultLike[] | readonly TokenSearchResult[],
  chain?: string
): ResolvedTokenIdentity | undefined {
  const tokenKey = chain === 'Solana' ? token : token.toLowerCase()
  for (const candidate of results) {
    const deployment = candidate.deployments.find(d => {
      if (chain && d.chain !== chain) return false
      const contractKey = d.chain === 'Solana' ? d.contractAddress : d.contractAddress.toLowerCase()
      return contractKey === tokenKey
    })
    if (!deployment) continue
    return {
      symbol: candidate.symbol.toUpperCase(),
      name: candidate.name,
      coingeckoId: candidate.id,
      ...(deployment.decimals !== undefined ? { decimals: deployment.decimals } : {}),
    }
  }
  return undefined
}
