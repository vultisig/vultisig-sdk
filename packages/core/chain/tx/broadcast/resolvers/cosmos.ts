import { CosmosChain } from '@vultisig/core-chain/Chain'
import { getCosmosClient } from '@vultisig/core-chain/chains/cosmos/client'
import { attempt } from '@vultisig/lib-utils/attempt'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({
  chain,
  tx: { serialized },
}) => {
  const { tx_bytes } = JSON.parse(serialized)
  const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

  const client = await getCosmosClient(chain)
  const { error } = await attempt(client.broadcastTx(decodedTxBytes))

  if (error && !isInError(error, 'tx already exists in cache')) {
    throw error
  }
}
