import { OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastRippleTx: BroadcastTxResolver<
  OtherChain.Ripple
> = async ({ chain, tx }) => {
  const client = await getRippleClient()

  try {
    await client.request({
      command: 'submit',
      tx_blob: Buffer.from(tx.encoded).toString('hex'),
    })
  } catch (error) {
    await verifyBroadcastByHash({ chain, tx, error })
  }
}
