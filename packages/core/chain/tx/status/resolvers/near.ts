import { OtherChain } from '@vultisig/core-chain/Chain'
import { callNearRpc, getNearRpcErrorName } from '@vultisig/core-chain/chains/near/rpc'
import { NearTxOutcome, readNearOutcomeHash } from '@vultisig/core-chain/chains/near/txOutcome'

import { TxStatusResolver } from '../resolver'

/** `status` is nearcore's `FinalExecutionStatus` (core/primitives/src/views.rs): `{ SuccessValue }` or `{ Failure }` once final. */
type NearStatusResponse = NearTxOutcome & { status?: unknown }

/**
 * `FINAL` is the only execution status that may be reported as success: an
 * `INCLUDED`/`EXECUTED_OPTIMISTIC` outcome can still be reverted, so those stay
 * `pending`. `EXECUTED` is not enough either — it means executed optimistically.
 */
const NEAR_FINAL_EXECUTION_STATUS = 'FINAL'

const readExecutionStatus = (response: NearStatusResponse): 'success' | 'error' | 'pending' => {
  if (response.final_execution_status !== NEAR_FINAL_EXECUTION_STATUS) {
    return 'pending'
  }

  const { status } = response

  if (typeof status === 'object' && status !== null) {
    if ('SuccessValue' in status) {
      return 'success'
    }

    if ('Failure' in status) {
      return 'error'
    }
  }

  throw new Error('NEAR transaction status response carries an unrecognized execution status')
}

/**
 * NEAR has no hash-only lookup: the node is asked by `(tx_hash, sender_account_id)`
 * because the lookup is sharded by sender, so a missing `senderAccountId` fails
 * closed instead of reporting an unknown hash as pending forever.
 *
 * UNKNOWN_TRANSACTION is `not_found` (affirmatively no record); a node-side wait
 * timeout is `pending` with `isKnown: false`.
 */
export const getNearTxStatus: TxStatusResolver<OtherChain.Near> = async ({ hash, senderAccountId }) => {
  if (!senderAccountId) {
    throw new Error(`NEAR transaction status needs the sender account id for ${hash}`)
  }

  let response: NearStatusResponse

  try {
    response = await callNearRpc<NearStatusResponse>('tx', {
      tx_hash: hash,
      sender_account_id: senderAccountId,
      wait_until: NEAR_FINAL_EXECUTION_STATUS,
    })
  } catch (error) {
    const errorName = getNearRpcErrorName(error)

    if (errorName === 'UNKNOWN_TRANSACTION') {
      return { status: 'not_found', isKnown: false }
    }

    if (errorName === 'TIMEOUT_ERROR') {
      return { status: 'pending', isKnown: false }
    }

    throw error
  }

  const returnedHash = readNearOutcomeHash(response)

  if (returnedHash !== undefined && returnedHash !== hash) {
    throw new Error(`NEAR status for ${hash} returned the outcome of ${returnedHash}`)
  }

  const status = readExecutionStatus(response)

  // A FINAL outcome always names its transaction; one that does not cannot be bound to this hash.
  if (status !== 'pending' && returnedHash === undefined) {
    throw new Error(`NEAR status for ${hash} reported a final outcome without the transaction hash`)
  }

  return { status, isKnown: returnedHash !== undefined }
}
