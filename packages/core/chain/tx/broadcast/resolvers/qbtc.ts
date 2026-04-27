import { Chain } from '@vultisig/core-chain/Chain'
import { qbtcRestUrl } from '@vultisig/core-chain/chains/cosmos/qbtc/tendermintRpcUrl'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastQbtcTx: BroadcastTxResolver<typeof Chain.QBTC> = async ({
  chain,
  tx,
}) => {
  const { serialized } = tx
  const { tx_bytes } = JSON.parse(serialized) as { tx_bytes: string }

  const resp = await fetch(`${qbtcRestUrl}/cosmos/tx/v1beta1/txs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tx_bytes,
      mode: 'BROADCAST_MODE_SYNC',
    }),
  })

  if (!resp.ok) {
    const text = await resp.text()
    if (isInError(text, 'tx already exists in cache')) {
      return
    }
    const err = new Error(`QBTC broadcast failed (${resp.status}): ${text}`)
    await verifyBroadcastByHash({ chain, tx, error: err })
    return
  }

  const data = (await resp.json()) as {
    tx_response?: { code?: number; raw_log?: string; log?: string }
  }
  const { error } = await attempt(async () => {
    if (data.tx_response?.code && data.tx_response.code !== 0) {
      throw new Error(
        `QBTC tx error: ${data.tx_response.raw_log || data.tx_response.log}`
      )
    }
  })

  if (!error) {
    return
  }

  if (isInError(error, 'tx already exists in cache')) {
    return
  }

  await verifyBroadcastByHash({ chain, tx, error })
}
