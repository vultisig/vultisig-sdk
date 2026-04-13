import { OtherChain } from '@vultisig/core-chain/Chain'
import { toCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { getCardanoAddressAssets } from '@vultisig/core-chain/chains/cardano/client/getCardanoAddressAssets'
import { FindCoinsResolver } from '@vultisig/core-chain/coin/find/resolver'

/** Discovers Cardano native tokens held at the given address. */
export const findCardanoCoins: FindCoinsResolver<
  OtherChain.Cardano
> = async ({ address, chain }) => {
  const assets = await getCardanoAddressAssets(address)

  return assets.map(({ policy_id, asset_name, decimals }) => {
    const assetNameAscii = Buffer.from(asset_name, 'hex').toString('ascii')

    return {
      id: toCardanoAssetId({ policyId: policy_id, assetName: asset_name }),
      chain,
      decimals,
      ticker: assetNameAscii || policy_id.slice(0, 8).toUpperCase(),
      address,
    }
  })
}
