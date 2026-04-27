import { OtherChain } from '@vultisig/core-chain/Chain'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastTonTx: BroadcastTxResolver<OtherChain.Ton> = async ({
  chain,
  tx,
}) => {
  const url = `${rootApiUrl}/ton/v2/sendBocReturnHash`

  const { error } = await attempt(
    queryUrl<{ result: { hash: string } }>(url, {
      body: { boc: tx.encoded },
    })
  )

  if (!error) {
    return
  }

  if (isInError(error, 'duplicate message', 'duplicate msg_seqno')) {
    return
  }

  await verifyBroadcastByHash({ chain, tx, error })
}
