import { OtherChain } from '@vultisig/core-chain/Chain'
import { getCardanoTxTtl } from '@vultisig/core-chain/chains/cardano/cip30/cardanoTxTtl'
import { getCardanoCurrentSlot } from '@vultisig/core-chain/chains/cardano/client/currentSlot'
import { cardanoBroadcastTtlSafetyMargin } from '@vultisig/core-chain/chains/cardano/config'
import { getCardanoTxHash } from '@vultisig/core-chain/tx/hash/resolvers/cardano'

import { submitCardanoCbor } from '../../../chains/cardano/submit/submitCardanoCbor'
import { BroadcastTxResolver } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'
import { selectEncodedBytes } from './utxo'

/**
 * Ogmios code for "transaction already known / in ledger". When the node
 * reports this, we hash the tx locally to return the deterministic id.
 */
const alreadyCommittedCode = 3117

const assertCardanoTtlFreshForBroadcast = async (encodedBytes: Uint8Array) => {
  const ttl = getCardanoTxTtl(encodedBytes)
  const currentSlot = await getCardanoCurrentSlot()
  const minimumFreshTtl = currentSlot + BigInt(cardanoBroadcastTtlSafetyMargin)

  if (ttl <= minimumFreshTtl) {
    throw new Error(
      `Cardano transaction TTL is expired or too close to expiry; rebuild the transaction and retry (ttl=${ttl}, currentSlot=${currentSlot}, safetyMargin=${cardanoBroadcastTtlSafetyMargin} slots)`
    )
  }
}

export const broadcastCardanoTx: BroadcastTxResolver<OtherChain.Cardano> = async ({ chain, tx }) => {
  const encodedBytes = selectEncodedBytes(chain, tx)
  await assertCardanoTtlFreshForBroadcast(encodedBytes)

  const cborHex = Buffer.from(encodedBytes).toString('hex')

  const { txHash, errorMessage, rpcErrorCode } = await submitCardanoCbor(cborHex)

  if (txHash) return txHash

  if (rpcErrorCode === alreadyCommittedCode) {
    return (await getCardanoTxHash(tx)).replace(/^0x/i, '')
  }

  const error = errorMessage ?? 'unknown broadcast failure'

  // Any submit error past this point is ambiguous — it could be a benign MPC-race duplicate (another
  // device already broadcast the same signed tx) OR a genuine failure (e.g. BadInputsUTxO: spent/invalid
  // inputs). String-matching alone can't tell them apart, so verify against the real chain: the hash
  // either resolves on-chain (the race case — success) or it doesn't (the real failure — rethrows).
  const broadcastError = new Error(`Failed to broadcast transaction: ${error}`)
  await verifyBroadcastByHash({ chain, tx, error: broadcastError })
  return null
}
