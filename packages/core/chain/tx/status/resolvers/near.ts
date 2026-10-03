import { callNearRpc, getNearRpcErrorName } from '@vultisig/core-chain/chains/near/rpc'

import { TxStatusResolver, TxStatusResult } from '../resolver'

type NearExecutionStatus = 'SuccessValue' | 'SuccessReceiptId'

type NearStatusResponse = {
  final_execution_status?: unknown
  status?: { SuccessValue?: unknown; SuccessReceiptId?: unknown; Failure?: unknown } | NearExecutionStatus
  transaction?: { hash?: unknown }
  transaction_outcome?: { id?: unknown }
}

/**
 * `FINAL` is the only execution status that may be reported as success: an
 * `INCLUDED`/`EXECUTED_OPTIMISTIC` outcome can still be reverted, so those stay
 * `pending`. `EXECUTED` is not enough either — it means executed optimistically.
 */
const NEAR_FINAL_EXECUTION_STATUS = 'FINAL'

const readTransactionHash = (response: NearStatusResponse): string | undefined => {
  const hash = response.transaction?.hash ?? response.transaction_outcome?.id

  return typeof hash === 'string' && hash.length > 0 ? hash : undefined
}

const readExecutionStatus = (response: NearStatusResponse): 'success' | 'error' | 'pending' => {
  if (response.final_execution_status !== NEAR_FINAL_EXECUTION_STATUS) {
    return 'pending'
  }

  const status = response.status

  if (status === 'SuccessValue' || status === 'SuccessReceiptId') {
    return 'success'
  }

  if (typeof status === 'object' && status !== null) {
    if ('SuccessValue' in status || 'SuccessReceiptId' in status) {
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
export const getNearTxStatus: TxStatusResolver = async ({ hash, senderAccountId }) => {
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

  const returnedHash = readTransactionHash(response)

  if (returnedHash !== undefined && returnedHash !== hash) {
    throw new Error(`NEAR status for ${hash} returned the outcome of ${returnedHash}`)
  }

  const status = readExecutionStatus(response)

  const result: TxStatusResult = { status, isKnown: returnedHash !== undefined }

  return result
}
