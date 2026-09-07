import { baseJupiterTokensUrl, getJupiterTokens } from '@vultisig/core-chain/coin/jupiter/api'

import { getSolanaCoingeckoId } from '../../../coingecko/getCoingeckoId'
import { TokenMetadataResolver } from '../resolver'

/** Kept on this subpath for consumers that read the Jupiter base URL from the resolver module. */
export { baseJupiterTokensUrl }

export const getSolanaTokenMetadata: TokenMetadataResolver = async ({ id }) => {
  const token = (await getJupiterTokens([id]))[id]
  if (!token) {
    throw new Error(`Jupiter has no metadata for Solana mint ${id}`)
  }

  const coingeckoId = await getSolanaCoingeckoId({ id })

  return {
    decimals: token.decimals,
    logo: token.icon,
    ticker: token.symbol,
    priceProviderId: coingeckoId,
  }
}
