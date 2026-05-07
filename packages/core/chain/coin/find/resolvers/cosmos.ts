import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { tcyAutoCompounderConfig } from '@vultisig/core-chain/chains/cosmos/thor/tcy-autocompound/config'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { getCosmosTokenMetadata } from '@vultisig/core-chain/coin/token/metadata/resolvers/cosmos'
import { without } from '@vultisig/lib-utils/array/without'

export const findCosmosCoins: FindCoinsResolver<CosmosChain> = async ({ address, chain }) => {
  // While it should work for other cosmos chains, we only support THORChain for now
  if (chain !== CosmosChain.THORChain) return []

  const client = await getCosmosClient(chain)
  const balances = await client.getAllBalances(address)
  const coins = await Promise.all(
    without(
      balances.map(({ denom }) => denom),
      cosmosFeeCoinDenom[chain],
      tcyAutoCompounderConfig.shareDenom
    ).map(denom =>
      getCosmosTokenMetadata({ chain, id: denom })
        .then(({ ticker }) => ({ denom, ticker }))
        .catch(() => ({ denom, ticker: undefined }))
    )
  )

  return without(
    coins.map(({ denom, ticker }) => {
      // #428: use the LAST slash-segment of the denom, not the second
      // element. factory/{addr}/{subdenom} shaped denoms (THORChain
      // factory tokens, etc.) put the meaningful ticker at index 2; the
      // legacy split(/[-./]/)[1] form would resolve to the creator
      // address.
      //
      // Semantics intentionally mirror the metadata resolver
      // (packages/core/chain/coin/token/metadata/resolvers/cosmos.ts
      // deriveTicker for the `factory/` branch): only split on `/`, NOT
      // on `.` or `-`. That preserves dotted suffixes (`usdc.v2` -> `USDC.V2`,
      // not `V2`) and hyphenated tails (yield-bearing tokens like
      // `factory/.../yA-USDC`) instead of stripping them.
      const coinTicker = ticker || denom.split('/').at(-1)?.toUpperCase()

      if (!coinTicker) {
        console.error(`Failed to extract ticker from ${denom}`)
        return
      }

      return {
        id: denom,
        chain,
        decimals: chainFeeCoin[chain].decimals,
        ticker: coinTicker,
        logo: coinTicker.toLowerCase(),
        address,
      }
    }),
    undefined
  )
}
