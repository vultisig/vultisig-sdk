import { assertIsDeliverTxSuccess } from '@cosmjs/stargate'
import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({ chain, tx }) => {
  const { serialized } = tx
  const { tx_bytes } = JSON.parse(serialized)
  const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

  const client = await getCosmosClient(chain)
  const { data, error } = await attempt(client.broadcastTx(decodedTxBytes))

  if (data) {
    // client.broadcastTx resolves (does not throw) once the tx is INCLUDED in a
    // block, even when execution itself failed (DeliverTx code !== 0 — e.g.
    // out-of-gas, wasm revert, a THORChain/Maya deposit-handler rejection). The
    // tx is on-chain but nothing moved, so this must not be reported as success.
    assertIsDeliverTxSuccess(data)
    return
  }

  if (isInError(error, 'tx already exists in cache')) {
    return
  }

  await verifyBroadcastByHash({ chain, tx, error })
}
