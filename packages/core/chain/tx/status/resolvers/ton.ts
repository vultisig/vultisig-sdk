import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

type TonComputePhase = {
  exit_code?: number
}

type TonActionPhase = {
  success?: boolean
  no_funds?: boolean
  result_code?: number
  skipped_actions?: number
}

type TonTransactionDescription = {
  aborted?: boolean
  compute_ph?: TonComputePhase
  action?: TonActionPhase
}

type TonTransaction = {
  hash: string
  total_fees: string
  description?: TonTransactionDescription
}

type TonTransactionsResponse = {
  transactions: Array<TonTransaction>
}

/**
 * TVM exit codes 0 and 1 are the success conventions; any other code is a revert.
 * An absent code means the message had no compute phase (a plain transfer to a
 * wallet), which is not a failure.
 */
const hasComputePhaseFailed = (computePhase: TonComputePhase | undefined): boolean => {
  const exitCode = computePhase?.exit_code

  return exitCode !== undefined && exitCode !== 0 && exitCode !== 1
}

/**
 * The action phase is where the wallet contract actually emits the outgoing
 * transfer, so it is where the money moves. A transaction can pass its compute
 * phase and land un-aborted while its action phase moved nothing — the seqno is
 * consumed either way — so this is what separates a real send from a silent
 * no-op. `result_code` is checked alongside `success` because indexers do not
 * always populate both.
 */
const hasActionPhaseFailed = (actionPhase: TonActionPhase | undefined): boolean => {
  if (!actionPhase) {
    return false
  }

  const { success, no_funds, result_code, skipped_actions } = actionPhase

  return success === false || no_funds === true || (result_code ?? 0) !== 0 || (skipped_actions ?? 0) > 0
}

/**
 * Resolves a TON transaction by the hash of the external message that carried it.
 * Success requires the transaction to be un-aborted *and* to have cleared both the
 * compute and the action phase; a transaction the indexer knows but hasn't fully
 * described yet stays pending.
 */
export const getTonTxStatus: TxStatusResolver<OtherChain.Ton> = async ({ hash }) => {
  const url = `${rootApiUrl}/ton/v3/transactionsByMessage?msg_hash=${hash}&direction=in&limit=1`

  const { data: response, error } = await attempt(queryUrl<TonTransactionsResponse>(url))

  if (error || !response || response.transactions.length === 0) {
    return { status: 'pending', isKnown: false }
  }

  const tx = response.transactions[0]
  const { description } = tx

  if (!description) {
    // Indexed, but the execution details haven't landed yet. Keep polling rather
    // than reading the missing phases as success.
    return { status: 'pending', isKnown: true }
  }

  const feeCoin = chainFeeCoin[Chain.Ton]
  const feeStr = tx.total_fees
  const receipt =
    feeStr != null && feeStr !== ''
      ? {
          feeAmount: BigInt(feeStr),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  const failed =
    description.aborted === true ||
    hasComputePhaseFailed(description.compute_ph) ||
    hasActionPhaseFailed(description.action)

  return { status: failed ? 'error' : 'success', receipt }
}
