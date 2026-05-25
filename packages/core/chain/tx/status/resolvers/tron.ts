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
  // Top-level failure marker. Tron RPC only ever emits "FAILED" here (no "SUCCESS" variant exists
  // at this level). The field is absent on success. iOS checks `topLevelResult == "FAILED"`, we
  // mirror that exact guard. Tron protocol ref: wallet/gettransactioninfobyid response shape:
  // https://developers.tron.network/reference/gettransactioninfobyid
  result?: string
  receipt?: {
    // Only present when the tx failed. Known values: "FAILED", "OUT_OF_ENERGY", "REVERT",
    // "OUT_OF_TIME", "BANDWIDTH_ERROR", "ACCOUNT_FREEZED". Absent on success.
    result?: string
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
  //    Tron RPC only emits "FAILED" here — no "SUCCESS" counterpart exists at the top level.
  //    iOS ref: `if let topLevelResult = response.data.result, topLevelResult == "FAILED"`
  //    (TronTransactionStatusProvider.swift:41 — same guard, same single-value invariant)
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
  // optional-binding semantics where `if let receiptResult = receipt.result` fires for any
  // non-nil value including "". Per Tron protocol, an empty string receipt.result signals a
  // contract execution failure where the node wrote a receipt object but produced no explicit
  // error code (e.g. internal assertion failed silently). It is non-null → non-success.
  // iOS ref: TronTransactionStatusProvider.swift:53 — `if let receiptResult = receipt.result`
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
