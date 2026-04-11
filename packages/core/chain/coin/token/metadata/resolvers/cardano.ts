import { OtherChain } from '@vultisig/core-chain/Chain'
import { fromCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { getCardanoAssetInfo } from '@vultisig/core-chain/chains/cardano/client/getCardanoAssetInfo'
import { TokenMetadataResolver } from '@vultisig/core-chain/coin/token/metadata/resolver'

/**
 * Resolves Cardano native token metadata from the Koios `asset_info` endpoint.
 * The `id` field is expected in `policy_id.asset_name` format (both hex).
 */
export const getCardanoTokenMetadata: TokenMetadataResolver<
  OtherChain.Cardano
> = async ({ id }) => {
  const { policyId, assetName } = fromCardanoAssetId(id)
  const info = await getCardanoAssetInfo({ policyId, assetName })

  const registry = info.token_registry_metadata

  const ticker =
    registry?.ticker ??
    (info.asset_name_ascii || assetName.slice(0, 8).toUpperCase())

  const decimals = registry?.decimals ?? 0

  return {
    ticker,
    decimals,
  }
}
