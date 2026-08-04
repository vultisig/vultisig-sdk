import { OtherChain } from '@vultisig/core-chain/Chain'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastTronTx: BroadcastTxResolver<OtherChain.Tron> = async ({ chain, tx }) => {
  try {
    const result = await queryUrl<{ txid: string; result?: boolean; code?: string; message?: string }>(
      `${tronRpcUrl}/wallet/broadcasttransaction`,
      {
        body: tx.json,
      }
    )

    if (result.result === false || result.code) {
      const msg = result.message
        ? Buffer.from(result.message, 'hex').toString('utf8')
        : (result.code ?? 'Unknown error')
      throw new Error(`Tron broadcast failed: ${msg}`)
    }

    // Return the tx hash string, consistent with the other broadcast resolvers (which return a hash
    // or void) rather than the full RPC envelope. The SDK's BroadcastService discards this return and
    // derives the hash itself, so no consumer reads the object — this is a shape-consistency fix.
    return result.txid
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
