import { OtherChain } from '@vultisig/core-chain/Chain'
import { getCardanoTxHash } from '@vultisig/core-chain/tx/hash/resolvers/cardano'
import { isInError } from '@vultisig/lib-utils/error/isInError'

import { submitCardanoCbor } from '../../../chains/cardano/submit/submitCardanoCbor'

import { BroadcastTxResolver } from '../resolver'
import { selectEncodedBytes } from './utxo'

/**
 * Ogmios code for "transaction already known / in ledger". When the node
 * reports this, we hash the tx locally to return the deterministic id.
 */
const alreadyCommittedCode = 3117

export const broadcastCardanoTx: BroadcastTxResolver<
  OtherChain.Cardano
> = async ({ chain, tx }) => {
  const encodedBytes = selectEncodedBytes(chain, tx)
  const cborHex = Buffer.from(encodedBytes).toString('hex')

  const { txHash, errorMessage, rpcErrorCode } = await submitCardanoCbor(cborHex)

  if (txHash) return txHash

  if (rpcErrorCode === alreadyCommittedCode) {
    return (await getCardanoTxHash(tx)).replace(/^0x/i, '')
  }

  const error = errorMessage ?? 'unknown broadcast failure'

  if (
    isInError(
      error,
      'BadInputsUTxO',
      'timed out',
      'txn-mempool-conflict',
      'already known'
    )
  ) {
    return null
  }

  throw new Error(`Failed to broadcast transaction: ${error}`)
}
