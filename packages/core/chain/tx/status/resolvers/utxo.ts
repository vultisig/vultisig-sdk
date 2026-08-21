import { UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getBlockchairBaseUrl } from '../../../chains/utxo/client/getBlockchairBaseUrl'
import { TxStatusResolver } from '../resolver'

type BlockchairTxResponse = {
  data: Record<
    string,
    {
      transaction: {
        block_id: number | null
        fee?: number
      }
    }
  >
}

export const getUtxoTxStatus: TxStatusResolver<UtxoBasedChain> = async ({ chain, hash }) => {
  const baseUrl = getBlockchairBaseUrl(chain)
  const url = `${baseUrl}/dashboards/transaction/${hash}`

  const { data: response, error } = await attempt(queryUrl<BlockchairTxResponse>(url))

  if (error || !response) {
    // Transport / provider failure: we could not ask Blockchair the question at all, so the
    // tx stays ambiguous. Keep the non-terminal `pending` + `isKnown:false` shape so callers
    // do NOT mistake an outage for evidence that the hash never existed.
    return { status: 'pending', isKnown: false }
  }

  const indexedTx = response.data[hash]
  if (!indexedTx) {
    // Blockchair answered successfully and affirmatively has no record of this hash.
    // That is a genuine miss, not transport uncertainty.
    return { status: 'not_found', isKnown: false }
  }

  const tx = indexedTx.transaction

  if (tx.block_id === null || tx.block_id === -1) {
    // Blockchair HAS indexed this hash (mempool, not yet mined) — a real positive signal
    // the tx exists, unlike the "not found at all" branch above.
    return { status: 'pending', isKnown: true }
  }

  const feeCoin = chainFeeCoin[chain]
  const receipt =
    tx.fee != null && tx.fee >= 0
      ? {
          feeAmount: BigInt(tx.fee),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  return { status: 'success', receipt }
}
