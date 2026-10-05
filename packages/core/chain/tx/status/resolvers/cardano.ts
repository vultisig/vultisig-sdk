import { OtherChain } from '@vultisig/core-chain/Chain'
import { cardanoApiUrl } from '@vultisig/core-chain/chains/cardano/client/config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

type CardanoTxStatusResponse = Array<{
  tx_hash: string
  num_confirmations: number | null
}>

const isCardanoTxStatus = (value: unknown): value is CardanoTxStatusResponse[number] => {
  if (typeof value !== 'object' || value === null) return false

  const { tx_hash, num_confirmations } = value as Record<string, unknown>

  return (
    typeof tx_hash === 'string' &&
    (num_confirmations === null ||
      (typeof num_confirmations === 'number' && Number.isInteger(num_confirmations) && num_confirmations >= 0))
  )
}

export const getCardanoTxStatus: TxStatusResolver<OtherChain.Cardano> = async ({ hash }) => {
  const { data: response, error } = await attempt(
    queryUrl<CardanoTxStatusResponse>(`${cardanoApiUrl}/tx_status`, {
      body: { _tx_hashes: [hash] },
    })
  )

  if (error || !Array.isArray(response)) {
    return { status: 'pending', isKnown: false }
  }

  if (!response.every(isCardanoTxStatus)) {
    return { status: 'pending', isKnown: false }
  }

  const transaction = response.find(item => item.tx_hash === hash)

  // Koios answered successfully but omitted the hash, or returned its explicit
  // null confirmation marker: either form means it has no record of the tx.
  if (!transaction || transaction.num_confirmations === null) {
    return { status: 'not_found', isKnown: false }
  }

  const confirmations = transaction.num_confirmations

  if (confirmations === 0) {
    return { status: 'pending', isKnown: true }
  }

  return { status: 'success' }
}
