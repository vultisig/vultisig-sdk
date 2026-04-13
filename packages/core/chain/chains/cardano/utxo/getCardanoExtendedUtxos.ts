import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { cardanoApiUrl } from '../client/config'

type CardanoUtxoAsset = {
  policy_id: string
  asset_name: string
  decimals: number
  quantity: string
  fingerprint: string
}

export type CardanoExtendedUtxo = {
  hash: string
  amount: bigint
  index: number
  assets: CardanoUtxoAsset[]
}

type KoiosExtendedUtxoResponse = Array<{
  tx_hash: string
  tx_index: number
  value: string
  asset_list: CardanoUtxoAsset[] | null
}>

/**
 * Fetches UTXOs for a Cardano address with the `_extended` flag,
 * which includes the `asset_list` field for each UTXO.
 */
export const getCardanoExtendedUtxos = async (
  address: string
): Promise<CardanoExtendedUtxo[]> => {
  const url = `${cardanoApiUrl}/address_utxos`

  const response = await queryUrl<KoiosExtendedUtxoResponse>(url, {
    body: {
      _addresses: [address],
      _extended: true,
    },
  })

  return response.map(({ tx_hash, tx_index, value, asset_list }) => ({
    hash: tx_hash,
    amount: BigInt(value),
    index: tx_index,
    assets: asset_list ?? [],
  }))
}
