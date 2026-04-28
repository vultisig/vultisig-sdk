import { OtherChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastTronTx: BroadcastTxResolver<OtherChain.Tron> = async ({
  chain,
  tx,
}) => {
  try {
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
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
