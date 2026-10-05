import { UtxoBasedChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { getBlockchairBaseUrl } from '../../../chains/utxo/client/getBlockchairBaseUrl'
import { TxStatusResolver } from '../resolver'

type BlockchairTxResponse = {
  data:
    | []
    | Record<
        string,
        {
          transaction: {
            block_id: number | null
            fee?: number
          }
        }
      >
}

const getBlockchairTransaction = (response: BlockchairTxResponse, hash: string) => {
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data)) return undefined
  return response.data[hash]?.transaction
}

const isBlockchairNotFound = (response: BlockchairTxResponse): boolean =>
  Array.isArray(response.data) && response.data.length === 0

export const getUtxoTxStatus: TxStatusResolver<UtxoBasedChain> = async ({ chain, hash }) => {
  const baseUrl = getBlockchairBaseUrl(chain)
  const url = `${baseUrl}/dashboards/transaction/${hash}`

  const { data: response, error } = await attempt(queryUrl<BlockchairTxResponse>(url))

  if (error || !response) {
    return { status: 'pending', isKnown: false }
  }

  // Blockchair returns a successful response with data:[] when the hash has no record.
  if (isBlockchairNotFound(response)) return { status: 'not_found', isKnown: false }

  const tx = getBlockchairTransaction(response, hash)
  if (!tx) return { status: 'pending', isKnown: false }

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
