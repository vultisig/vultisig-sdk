import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { cardanoApiUrl } from './config'

export type CardanoAddressAsset = {
  policy_id: string
  asset_name: string
  fingerprint: string
  decimals: number
  quantity: string
}

type CardanoAddressAssetResponse = Array<{
  address: string
  policy_id: string
  asset_name: string
  fingerprint: string
  decimals: number | null
  quantity: string
}>

/** Fetches all native tokens held at a Cardano address via the Koios `address_assets` endpoint. */
export const getCardanoAddressAssets = async (
  address: string
): Promise<CardanoAddressAsset[]> => {
  const url = `${cardanoApiUrl}/address_assets`

  const response = await queryUrl<CardanoAddressAssetResponse>(url, {
    body: {
      _addresses: [address],
    },
  })

  return response.map(({ policy_id, asset_name, fingerprint, decimals, quantity }) => ({
    policy_id,
    asset_name,
    fingerprint,
    decimals: decimals ?? 0,
    quantity,
  }))
}
