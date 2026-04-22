import { OtherChain } from '@vultisig/core-chain/Chain'
import { getSuiClient } from '@vultisig/core-chain/chains/sui/client'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastSuiTx: BroadcastTxResolver<OtherChain.Sui> = async ({
  chain,
  tx,
}) => {
  try {
    const client = await getSuiClient()
    return await client.executeTransactionBlock({
      transactionBlock: tx.unsignedTx,
      signature: [tx.signature],
    })
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
