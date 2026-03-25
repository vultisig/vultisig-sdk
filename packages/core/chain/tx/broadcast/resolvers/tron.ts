import { OtherChain } from '@core/chain/Chain'
import { queryUrl } from '@lib/utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { BroadcastTxResolver } from '../resolver'

export const broadcastTronTx: BroadcastTxResolver<OtherChain.Tron> = async ({
  tx,
}) => {
  const result = await queryUrl<{ txid: string; result?: boolean; code?: string; message?: string }>(`${tronRpcUrl}/wallet/broadcasttransaction`, {
    body: tx.json,
  })

  if (result.result === false || result.code) {
    const msg = result.message
      ? Buffer.from(result.message, 'hex').toString('utf8')
      : result.code ?? 'Unknown error'
    throw new Error(`Tron broadcast failed: ${msg}`)
  }

  return result
}
