import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { cardanoApiUrl } from '../client/config'

import type { ChainPlainUtxo } from '../../utxo/tx/ChainPlainUtxo'

type CardanoUtxoResponse = Array<{
  tx_hash: string
  tx_index: number
  value: string
}>

export const getCardanoUtxos = async (
  address: string
): Promise<ChainPlainUtxo[]> => {
  const url = `${cardanoApiUrl}/address_utxos`

  const utxos = await queryUrl<CardanoUtxoResponse>(url, {
    body: {
      _addresses: [address],
    },
  })

  return utxos.map(({ tx_hash, tx_index, value }) => ({
    hash: tx_hash,
    amount: BigInt(value),
    index: tx_index,
  }))
}
