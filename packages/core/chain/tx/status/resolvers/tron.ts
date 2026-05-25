import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { TxStatusResolver } from '../resolver'

type TronTxInfoResponse = {
  id?: string
  fee?: number
  blockNumber?: number
  result?: string // top-level failure marker; "FAILED" means the tx failed before receipt was written
  receipt?: {
    result?: string // only present on failure: "FAILED", "OUT_OF_ENERGY", "REVERT", etc.
  }
}

export const getTronTxStatus: TxStatusResolver<OtherChain.Tron> = async ({ hash }) => {
  const url = `${tronRpcUrl}/wallet/gettransactioninfobyid`

  const { data: tx, error } = await attempt(
    queryUrl<TronTxInfoResponse>(url, {
      body: { value: hash },
    })
  )

  if (error || !tx || tx.blockNumber === undefined || tx.blockNumber === 0) {
    return { status: 'pending' }
  }

  // iOS semantics (mirrors TronTransactionStatusProvider.swift):
  // 1. top-level result === "FAILED" → error (checked before receipt)
  // 2. receipt absent → pending (mined but no receipt object yet)
  // 3. receipt.result != null (any non-null value, including "") → error
  // 4. receipt present, result null/absent → success
  if (tx.result === 'FAILED') {
    return { status: 'error' }
  }

  if (!tx.receipt) {
    return { status: 'pending' }
  }

  // Use != null (not truthiness) so empty string "" also maps to error, matching iOS
  // optional-binding semantics where `if let x = receipt.result` fires for any non-nil value.
  const status = tx.receipt.result != null ? 'error' : 'success'
  const feeCoin = chainFeeCoin[Chain.Tron]
  const receipt =
    tx.fee != null
      ? {
          feeAmount: BigInt(tx.fee),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  return { status, receipt }
}
