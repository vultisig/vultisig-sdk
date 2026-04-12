import { OtherChain } from '@vultisig/core-chain/Chain'
import { fromCardanoAssetId } from '@vultisig/core-chain/chains/cardano/asset/cardanoAssetId'
import { getCardanoAddressAssets } from '@vultisig/core-chain/chains/cardano/client/getCardanoAddressAssets'
import { cardanoApiUrl } from '@vultisig/core-chain/chains/cardano/client/config'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CoinBalanceResolver } from '../resolver'

type CardanoAddressInfoResponse = Array<{
  balance: string
}>

/** Fetches the balance for ADA (when `id` is absent) or a Cardano native token (when `id` is present). */
export const getCardanoCoinBalance: CoinBalanceResolver<
  OtherChain.Cardano
> = async input => {
  if (input.id) {
    const { policyId, assetName } = fromCardanoAssetId(input.id)
    const normalizedPolicyId = policyId.toLowerCase()
    const normalizedAssetName = assetName.toLowerCase()
    const assets = await getCardanoAddressAssets(input.address)
    const match = assets.find(
      a =>
        a.policy_id.toLowerCase() === normalizedPolicyId &&
        a.asset_name.toLowerCase() === normalizedAssetName
    )
    return match ? BigInt(match.quantity) : 0n
  }

  const url = `${cardanoApiUrl}/address_info`

  const [{ balance } = { balance: '0' }] =
    await queryUrl<CardanoAddressInfoResponse>(url, {
      body: {
        _addresses: [input.address],
      },
    })

  return BigInt(balance)
}
