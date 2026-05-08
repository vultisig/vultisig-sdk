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
      // #428: ticker fallback for denoms that lack metadata. Tiered by
      // denom shape - they aren't all the same:
      //
      // 1. factory/{addr}/{subdenom} (THORChain factory tokens etc.) -
      //    use slash-last. The legacy `split(/[-./]/)[1]` would resolve
      //    to the creator address. Slash-last also preserves dotted
      //    suffixes (`usdc.v2` -> `USDC.V2`) and hyphenated tails
      //    (`yA-USDC` -> `YA-USDC`), mirroring the metadata resolver's
      //    deriveTicker semantics
      //    (packages/core/chain/coin/token/metadata/resolvers/cosmos.ts).
      //
      // 2. THORChain secured assets / dotted IBC (`btc-btc`,
      //    `eth-usdc-0xa0b...`, `foo/bar`) - the legacy `[-./]` split is
      //    correct, `[1]` resolves to the asset ticker (`btc`/`usdc`/
      //    `bar`). Switching ALL denoms to slash-last would regress
      //    these because `btc-btc` contains no `/` - `.at(-1)` would
      //    surface the entire denom (`BTC-BTC`).
      //
      // 3. Single-token (no separator, e.g. `mysterytoken`) - the
      //    `[-./]` split returns `[1] = undefined`, so we fall back to
      //    the denom itself uppercased. Strictly better than silently
      //    dropping the coin from the user's balance list.
      const factoryTail = denom.startsWith('factory/')
        ? denom.split('/').at(-1)
        : undefined
      const legacyMid = denom.split(/[-./]/)[1]
      const coinTicker = (
        ticker ||
        factoryTail ||
        legacyMid ||
        denom
      )?.toUpperCase()

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
