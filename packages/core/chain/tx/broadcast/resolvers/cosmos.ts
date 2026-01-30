import { CosmosChain } from '@core/chain/Chain'
import { getCosmosClient } from '@core/chain/chains/cosmos/client'
import { attempt } from '@lib/utils/attempt'
import { isInError } from '@lib/utils/error/isInError'

import { BroadcastTxResolver } from '../resolver'

export const broadcastCosmosTx: BroadcastTxResolver<CosmosChain> = async ({
  chain,
  tx: { serialized },
}) => {
  const { tx_bytes } = JSON.parse(serialized)
  const decodedTxBytes = Buffer.from(tx_bytes, 'base64')

  const client = await getCosmosClient(chain)
  const { data: result, error } = await attempt(client.broadcastTx(decodedTxBytes))

  if (result) {
    console.log('[DEBUG] Cosmos broadcast - code:', result.code, 'codespace:', result.codespace, 'hash:', result.transactionHash, 'rawLog:', result.rawLog)
  }
  if (error) {
    console.log('[DEBUG] Cosmos broadcast error:', error)
  }

  if (error && !isInError(error, 'tx already exists in cache')) {
    throw error
  }

  // Check if broadcast returned with error code
  if (result && result.code !== 0) {
    throw new Error(`Broadcasting transaction failed with code ${result.code} (codespace: ${result.codespace}). Log: ${result.rawLog}`)
  }
}
