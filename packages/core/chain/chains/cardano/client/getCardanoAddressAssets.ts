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

// Koios caps every response at 1000 rows (confirmed live: an unbounded
// address_assets query returns exactly 1000) and paginates via offset/limit.
// A single unbounded call therefore truncates any wallet holding >1000 native
// assets - realistic on Cardano since every NFT is its own native asset, so an
// NFT-heavy wallet blows past 1000 easily. That truncation is silent and hits
// BOTH callers: the discovery resolver drops tokens past row 1000 entirely, and
// the per-token balance resolver's `.find()` returns 0 for a token the user
// actually holds. Page through offsets until a short page proves the end,
// mirroring getUtxoAddressInfo's blockchair pagination.
const KOIOS_PAGE_SIZE = 1000

/** Fetches all native tokens held at a Cardano address via the Koios `address_assets` endpoint. */
export const getCardanoAddressAssets = async (address: string): Promise<CardanoAddressAsset[]> => {
  const rows: CardanoAddressAssetResponse = []

  for (let offset = 0; ; offset += KOIOS_PAGE_SIZE) {
    const url = `${cardanoApiUrl}/address_assets?limit=${KOIOS_PAGE_SIZE}&offset=${offset}`
    const page = await queryUrl<CardanoAddressAssetResponse>(url, {
      body: {
        _addresses: [address],
      },
    })

    rows.push(...page)

    if (page.length < KOIOS_PAGE_SIZE) {
      break
    }
  }

  return rows.map(({ policy_id, asset_name, fingerprint, decimals, quantity }) => ({
    policy_id,
    asset_name,
    fingerprint,
    decimals: decimals ?? 0,
    quantity,
  }))
}
