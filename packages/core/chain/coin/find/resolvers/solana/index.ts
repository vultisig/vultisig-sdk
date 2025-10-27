import { getSplAccounts } from '../../../../chains/solana/spl/getSplAccounts'
import { FindCoinsResolver } from '../../resolver'
import { without } from '../../../../../../lib/utils/array/without'
import { attempt } from '../../../../../../lib/utils/attempt'

import { Chain } from '../../../../Chain'
import { getSolanaTokenMetadata } from '../../../token/metadata/resolvers/solana'

export const findSolanaCoins: FindCoinsResolver = async ({ address }) => {
  const accounts = await getSplAccounts(address)

  const tokenAddresses = accounts.map(
    account => account.account.data.parsed.info.mint
  )

  const result = await Promise.all(
    tokenAddresses.map(async id => {
      const key = { id, chain: Chain.Solana } as const
      const { data } = await attempt(getSolanaTokenMetadata(key))

      if (data && data.priceProviderId) {
        return { ...key, ...data, address }
      }
    })
  )

  return without(result, undefined)
}
