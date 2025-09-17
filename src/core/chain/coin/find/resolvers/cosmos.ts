import { CosmosChain } from '../../../Chain'
import { getCosmosClient } from '../../../chains/cosmos/client'
import { cosmosFeeCoinDenom } from '../../../chains/cosmos/cosmosFeeCoinDenom'
import { chainFeeCoin } from '../../chainFeeCoin'
import { FindCoinsResolver } from '../resolver'
import { without } from '../../../../../lib/utils/array/without'
import { shouldBePresent } from '../../../../../lib/utils/assert/shouldBePresent'
import { attempt } from '../../../../../lib/utils/attempt'

export const findCosmosCoins: FindCoinsResolver<CosmosChain> = async ({
  address,
  chain,
}) => {
  // While it should work for other cosmos chains, we only support THORChain for now
  if (chain !== CosmosChain.THORChain) {
    return []
  }

  const client = await getCosmosClient(chain)
  const balances = await client.getAllBalances(address)

  const denoms = without(
    balances.map(balance => balance.denom),
    cosmosFeeCoinDenom[chain]
  )

  return without(
    denoms.map(denom => {
      const tickerAttempt = attempt(() =>
        shouldBePresent(denom.split(/[-./]/).at(1)?.toUpperCase())
      )

      if ('error' in tickerAttempt) {
        console.error(`Failed to extract ticker from ${denom}`)
        return
      }

      const ticker = tickerAttempt.data
      const logo = ticker.toLowerCase()

      return {
        id: denom,
        chain,
        decimals: chainFeeCoin[chain].decimals,
        ticker,
        logo,
        address,
      }
    }),
    undefined
  )
}
