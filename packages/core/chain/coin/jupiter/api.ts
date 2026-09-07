import { SolanaJupiterToken } from '@vultisig/core-chain/coin/jupiter/token'
import { rootApiUrl } from '@vultisig/core-config'
import { toBatches } from '@vultisig/lib-utils/array/toBatches'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

/** Jupiter's Token API v2, reached through the Vultisig proxy. */
export const baseJupiterTokensUrl = `${rootApiUrl}/jup/tokens/v2`

/** Jupiter's search endpoint accepts up to a hundred comma-separated mints per call. */
const mintsPerSearch = 100

// The verified list runs to several megabytes; a slow link should not turn it
// into a timeout, which would leave legitimate tokens unrecognised until retry.
const verifiedListTimeoutMs = 60_000

const isJupiterToken = (value: unknown): value is SolanaJupiterToken => {
  if (typeof value !== 'object' || value === null) return false

  const { id, symbol } = value as { id?: unknown; symbol?: unknown }

  return typeof id === 'string' && typeof symbol === 'string'
}

const parseJupiterTokens = (response: unknown, source: string): SolanaJupiterToken[] => {
  if (!Array.isArray(response)) {
    throw new Error(`Jupiter ${source} did not return a token list`)
  }

  return response.filter(isJupiterToken)
}

/**
 * Metadata for the given mints, keyed by mint. One search call covers a
 * hundred mints, so a whole wallet costs a call or two rather than one per
 * token. A mint Jupiter does not index is simply absent from the result, and
 * the response is filtered to the requested mints so a lookalike match can
 * never stand in for a mint that was asked about.
 */
export const getJupiterTokens = async (mints: string[]): Promise<Record<string, SolanaJupiterToken>> => {
  const requested = withoutDuplicates(mints)
  const wanted = new Set(requested)

  const responses = await Promise.all(
    toBatches(requested, mintsPerSearch).map(batch =>
      queryUrl<unknown>(`${baseJupiterTokensUrl}/search?query=${batch.join(',')}`)
    )
  )

  const result: Record<string, SolanaJupiterToken> = {}
  for (const response of responses) {
    for (const token of parseJupiterTokens(response, 'search')) {
      if (wanted.has(token.id)) result[token.id] = token
    }
  }

  return result
}

/**
 * Every mint Jupiter marks verified: the community-reviewed list the major
 * Solana wallets show as their "verified" tier. Several megabytes, so callers
 * cache it.
 */
export const getJupiterVerifiedTokens = async (): Promise<SolanaJupiterToken[]> =>
  parseJupiterTokens(
    await queryUrl<unknown>(`${baseJupiterTokensUrl}/tag?query=verified`, { timeoutMs: verifiedListTimeoutMs }),
    'verified list'
  )
