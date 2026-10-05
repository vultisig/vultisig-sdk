import { OtherChain } from '@vultisig/core-chain/Chain'
import { getCardanoTxTtl } from '@vultisig/core-chain/chains/cardano/cip30/cardanoTxTtl'
import { getCardanoCurrentSlot } from '@vultisig/core-chain/chains/cardano/client/currentSlot'
import { cardanoBroadcastTtlSafetyMargin } from '@vultisig/core-chain/chains/cardano/config'
import { getCardanoTxHash } from '@vultisig/core-chain/tx/hash/resolvers/cardano'
import { attempt } from '@vultisig/lib-utils/attempt'

import { submitCardanoCbor } from '../../../chains/cardano/submit/submitCardanoCbor'
import { broadcastAccepted, broadcastFailed, BroadcastTxResolver, isRetryableBroadcastCause } from '../resolver'
import { verifyBroadcastByHash } from '../verifyBroadcastByHash'
import { selectEncodedBytes } from './utxo'

/**
 * Ogmios code for "transaction already known / in ledger". When the node
 * reports this, we hash the tx locally to return the deterministic id.
 */
const alreadyCommittedCode = 3117

/**
 * The ledger's verdict on a transaction none of whose inputs exist any more:
 * "All inputs are spent. Transaction has probably already been included".
 * Ogmios relays it as the justification of a mempool rejection (code 3997).
 */
const spentInputsPattern = /already been included|inputs are spent/i

/**
 * Status lookups to make after the node reports the inputs as spent. They are
 * 0.5s, 1s, 1.5s… apart, about 85 seconds of waiting in all (roughly four
 * Cardano block intervals) and close to two minutes with the lookups' own
 * latency. The default window of about 3 seconds only covers RPC propagation,
 * while a copy another device just broadcast stays invisible to the status
 * lookup until it is in a block.
 */
export const cardanoSpentInputsVerificationAttempts = 19

const getCardanoCurrentSlotForBroadcast = async (): Promise<bigint | null> => {
  const first = await attempt(getCardanoCurrentSlot())
  if (!('error' in first)) return first.data

  const second = await attempt(getCardanoCurrentSlot())
  if (!('error' in second)) return second.data

  return null
}

export const getCardanoTtlFreshnessError = ({
  currentSlot,
  ttl,
}: {
  currentSlot: bigint | null
  ttl: bigint
}): Error | null => {
  if (currentSlot === null) {
    return null
  }

  const minimumFreshTtl = currentSlot + BigInt(cardanoBroadcastTtlSafetyMargin)

  if (ttl <= minimumFreshTtl) {
    return new Error(
      `Cardano transaction TTL is expired or too close to expiry; rebuild the transaction and retry (ttl=${ttl}, currentSlot=${currentSlot}, safetyMargin=${cardanoBroadcastTtlSafetyMargin} slots)`
    )
  }

  return null
}

export const assertCardanoTtlFreshForBroadcast = async (encodedBytes: Uint8Array) => {
  const ttl = getCardanoTxTtl(encodedBytes)
  const currentSlot = await getCardanoCurrentSlotForBroadcast()

  const freshnessError = getCardanoTtlFreshnessError({ currentSlot, ttl })
  if (freshnessError) {
    throw freshnessError
  }
}

export const broadcastCardanoTx: BroadcastTxResolver<OtherChain.Cardano> = async ({ chain, tx }) => {
  try {
    const encodedBytes = selectEncodedBytes(chain, tx)
    await assertCardanoTtlFreshForBroadcast(encodedBytes)

    const cborHex = Buffer.from(encodedBytes).toString('hex')

    const { txHash, errorMessage, rpcErrorCode, rpcErrorDetail } = await submitCardanoCbor(cborHex)

    if (txHash) return broadcastAccepted(txHash)

    if (rpcErrorCode === alreadyCommittedCode) {
      return broadcastAccepted((await getCardanoTxHash(tx)).replace(/^0x/i, ''))
    }

    const error = errorMessage ?? 'unknown broadcast failure'

    // Any submit error past this point is ambiguous — it could be a benign MPC-race duplicate (another
    // device already broadcast the same signed tx) OR a genuine failure (e.g. BadInputsUTxO: spent/invalid
    // inputs). String-matching alone can't tell them apart, so verify against the real chain: the hash
    // either resolves on-chain (the race case — success) or it doesn't (the real failure — returns it).
    const broadcastError = new Error(`Failed to broadcast transaction: ${error}`)

    // "All inputs are spent" is what the loser of an MPC broadcast race is told, and equally what a
    // transaction built on UTXOs that something else spent is told, so it proves nothing about this
    // transaction. It only says how long to look: a peer's copy sits in the mempool, where the status
    // lookup cannot see it, and its hash shows up once the next block is made.
    const isWaitingForBlock = rpcErrorDetail !== undefined && spentInputsPattern.test(rpcErrorDetail)

    try {
      return broadcastAccepted(
        await verifyBroadcastByHash({
          chain,
          tx,
          error: broadcastError,
          ...(isWaitingForBlock ? { maxAttempts: cardanoSpentInputsVerificationAttempts } : {}),
        })
      )
    } catch (cause) {
      return broadcastFailed(cause, isRetryableBroadcastCause(broadcastError))
    }
  } catch (cause) {
    return broadcastFailed(cause, isRetryableBroadcastCause(cause))
  }
}
