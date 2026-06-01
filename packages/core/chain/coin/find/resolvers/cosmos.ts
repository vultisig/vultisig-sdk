import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { cosmosFeeCoinDenom } from '@vultisig/core-chain/chains/cosmos/cosmosFeeCoinDenom'
import { tcyAutoCompounderConfig } from '@vultisig/core-chain/chains/cosmos/thor/tcy-autocompound/config'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { CoinMetadata } from '@vultisig/core-chain/coin/Coin'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'
import { getCosmosTokenMetadata } from '@vultisig/core-chain/coin/token/metadata/resolvers/cosmos'
import { without } from '@vultisig/lib-utils/array/without'

const AUTO_DISCOVERY_CHAINS = new Set<CosmosChain>([
  CosmosChain.THORChain,
  CosmosChain.Terra,
  CosmosChain.TerraClassic,
  CosmosChain.Osmosis,
])

type DiscoveredDenom = {
  denom: string
  metadata?: CoinMetadata
  isHidden?: boolean
}

const getFallbackTicker = (denom: string) => {
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
  const factoryTail = denom.startsWith('factory/') ? denom.split('/').at(-1) : undefined
  const legacyMid = denom.split(/[-./]/)[1]

  return (factoryTail || legacyMid || denom)?.toUpperCase()
}

const getDiscoveredDenom = async (chain: CosmosChain, denom: string): Promise<DiscoveredDenom> =>
  getCosmosTokenMetadata({ chain, id: denom })
    .then(metadata => ({
      denom,
      metadata,
    }))
    .catch(() => ({
      denom,
      isHidden: chain === CosmosChain.THORChain ? undefined : true,
    }))

export const findCosmosCoins: FindCoinsResolver<CosmosChain> = async ({ address, chain }) => {
  if (!AUTO_DISCOVERY_CHAINS.has(chain)) return []

  const client = await getCosmosClient(chain)
  const balances = await client.getAllBalances(address)
  const coins = await Promise.all(
    without(
      balances.map(({ denom }) => denom),
      cosmosFeeCoinDenom[chain],
      tcyAutoCompounderConfig.shareDenom
    ).map(denom => getDiscoveredDenom(chain, denom))
  )

  return without(
    coins.map(({ denom, metadata, isHidden }) => {
      const coinTicker = (metadata?.ticker || getFallbackTicker(denom))?.toUpperCase()
      const coinIsHidden = isHidden ?? metadata?.isHidden

      if (!coinTicker) {
        console.error(`Failed to extract ticker from ${denom}`)
        return
      }

      return {
        id: denom,
        chain,
        decimals: metadata?.decimals ?? chainFeeCoin[chain].decimals,
        ticker: coinTicker,
        logo: metadata?.logo ?? coinTicker.toLowerCase(),
        ...(metadata?.priceProviderId === undefined ? {} : { priceProviderId: metadata.priceProviderId }),
        ...(coinIsHidden === undefined ? {} : { isHidden: coinIsHidden }),
        address,
      }
    }),
    undefined
  )
}
