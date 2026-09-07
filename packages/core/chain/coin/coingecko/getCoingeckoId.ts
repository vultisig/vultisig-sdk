import { rootApiUrl } from '@vultisig/core-config'
import { toBatches } from '@vultisig/lib-utils/array/toBatches'
import { withoutDuplicates } from '@vultisig/lib-utils/array/withoutDuplicates'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { SolanaCoingeckoTokenResponse, SolanaCoingeckoTokensResponse, SolanaFmTokenResponse } from './coingeckoToken'

const onchainSolanaTokensUrl = `${rootApiUrl}/coingeicko/api/v3/onchain/networks/solana/tokens`

/** CoinGecko documents up to thirty addresses per multi-token call. */
const mintsPerLookup = 30

export const getSolanaCoingeckoId = async ({ id }: { id: string }) => {
  const cgResult = await attempt(() => queryUrl<SolanaCoingeckoTokenResponse>(`${onchainSolanaTokensUrl}/${id}`))
  if ('data' in cgResult) {
    const coingeckoId = cgResult.data?.data?.attributes?.coingecko_coin_id ?? undefined
    if (coingeckoId) return coingeckoId
  }

  const fmResult = await attempt(() => queryUrl<SolanaFmTokenResponse>(`https://api.solana.fm/v1/tokens/${id}`))
  if ('data' in fmResult) {
    const fmId = fmResult.data?.tokenList?.extensions?.coingeckoId
    if (fmId) return fmId
  }

  return undefined
}

/**
 * CoinGecko ids for the given mints, keyed by mint as requested, read from
 * CoinGecko's on-chain index thirty mints per call. A mint it does not index,
 * or lists without a coin id, is absent from the result. A failed call
 * propagates instead of degrading to "no id": a caller that persists the
 * answer would otherwise store a priced token as unpriced for good, whereas a
 * failed call can simply be retried.
 */
export const getSolanaCoingeckoIds = async (ids: string[]): Promise<Record<string, string>> => {
  const requested = withoutDuplicates(ids)
  const requestedByKey = new Map(requested.map(id => [id.toLowerCase(), id]))

  const responses = await Promise.all(
    toBatches(requested, mintsPerLookup).map(batch =>
      queryUrl<SolanaCoingeckoTokensResponse>(`${onchainSolanaTokensUrl}/multi/${batch.join(',')}`)
    )
  )

  const result: Record<string, string> = {}
  for (const { data } of responses) {
    for (const { attributes } of data ?? []) {
      const id = requestedByKey.get(attributes?.address?.toLowerCase() ?? '')
      if (id && attributes?.coingecko_coin_id) result[id] = attributes.coingecko_coin_id
    }
  }

  return result
}
