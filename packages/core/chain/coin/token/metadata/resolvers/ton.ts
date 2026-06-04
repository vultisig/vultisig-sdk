import { OtherChain } from '@vultisig/core-chain/Chain'
import { getJettonMasterInfo } from '@vultisig/core-chain/chains/ton/api'

import { TokenMetadataResolver } from '../resolver'

/**
 * Resolves TON jetton metadata from the Toncenter v3 `/jetton/masters` endpoint.
 * The `id` is the jetton master contract address (user-friendly EQ.../UQ... form).
 */
export const getTonTokenMetadata: TokenMetadataResolver<OtherChain.Ton> = async ({ id }) => {
  const { ticker, decimals, logo } = await getJettonMasterInfo(id)

  return { ticker, decimals, logo }
}
