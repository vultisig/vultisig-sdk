import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { cardanoApiUrl } from './config'

type CardanoTokenRegistryMetadata = {
  name?: string
  ticker?: string
  decimals?: number
  logo?: string
  description?: string
  url?: string
}

export type CardanoAssetInfo = {
  policy_id: string
  asset_name: string
  asset_name_ascii: string
  fingerprint: string
  total_supply: string
  token_registry_metadata: CardanoTokenRegistryMetadata | null
}

type CardanoAssetInfoResponse = CardanoAssetInfo[]

/** Fetches metadata for a Cardano native asset via the Koios `asset_info` endpoint. */
export const getCardanoAssetInfo = async ({
  policyId,
  assetName,
}: {
  policyId: string
  assetName: string
}): Promise<CardanoAssetInfo> => {
  const url = `${cardanoApiUrl}/asset_info`

  const [info] = await queryUrl<CardanoAssetInfoResponse>(url, {
    body: {
      _asset_list: [[policyId, assetName]],
    },
  })

  if (!info) {
    throw new Error(
      `Asset info not found for ${policyId}.${assetName}`
    )
  }

  return info
}
