import { OtherChain } from '@vultisig/core-chain/Chain'
import { cardanoApiUrl } from '@vultisig/core-chain/chains/cardano/client/config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

type CardanoTxStatusResponse = Array<{
  tx_hash: string
  num_confirmations: number | null
}>

export const getCardanoTxStatus: TxStatusResolver<OtherChain.Cardano> = async ({ hash }) => {
  const { data: response, error } = await attempt(
    queryUrl<CardanoTxStatusResponse>(`${cardanoApiUrl}/tx_status`, {
      body: { _tx_hashes: [hash] },
    })
  )

  if (error || !Array.isArray(response)) {
    return { status: 'pending', isKnown: false }
  }

  const transaction = response.find(item => item?.tx_hash === hash)

  const confirmations = transaction?.num_confirmations

  if (typeof confirmations !== 'number' || !Number.isInteger(confirmations) || confirmations < 0) {
    return { status: 'pending', isKnown: false }
  }

  if (confirmations === 0) {
    return { status: 'pending', isKnown: true }
  }

  return { status: 'success' }
}
