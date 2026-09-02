import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getTonTxFailure } from '@vultisig/core-chain/chains/ton/failure'
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
 * Resolves a TON transaction by the hash of the external message that carried it.
 * Success requires the transaction to be un-aborted *and* to have cleared both the
 * compute and the action phase; a transaction the indexer knows but hasn't fully
 * described yet stays pending. The action phase matters because it is where the
 * wallet actually emits the transfer: a transaction can pass compute and land
 * un-aborted while moving nothing, with the seqno consumed either way. A failure
 * comes back explained (`failure`) so the UI can say what went wrong and how to
 * fix it.
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

  const failure = getTonTxFailure(description)

  return failure ? { status: 'error', receipt, failure } : { status: 'success', receipt }
}
