import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { rootApiUrl } from '@vultisig/core-config'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

type TonTransaction = {
  hash: string
  total_fees: string
  description?: {
    aborted?: boolean
    compute_ph?: {
      exit_code?: number
    }
  }
}

type TonTransactionsResponse = {
  transactions: Array<TonTransaction>
}

export const getTonTxStatus: TxStatusResolver<OtherChain.Ton> = async ({
  hash,
}) => {
  const url = `${rootApiUrl}/ton/v3/transactionsByMessage?msg_hash=${hash}&direction=in&limit=1`

  const { data: response, error } = await attempt(
    queryUrl<TonTransactionsResponse>(url)
  )

  if (error || !response || response.transactions.length === 0) {
    return { status: 'pending' }
  }

  const tx = response.transactions[0]

  // Check if transaction was aborted
  if (tx.description?.aborted) {
    return { status: 'error' }
  }

  // Check compute phase exit code
  const exitCode = tx.description?.compute_ph?.exit_code

  // Exit code 0 or 1 indicates success
  // If no exit code is present (simple transfers), assume success
  const success = exitCode === undefined || exitCode === 0 || exitCode === 1
  const status = success ? 'success' : 'error'

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

  return { status, receipt }
}
