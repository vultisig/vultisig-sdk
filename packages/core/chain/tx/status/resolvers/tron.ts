import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { tronRpcUrl } from '../../../chains/tron/config'
import { TxStatusResolver } from '../resolver'

// Terminal failure codes for ResourceReceipt.result (core/Tron.proto field 7, contractResult enum).
// Protobuf3 JSON serializes non-default enum values by name: successful TRC20 calls emit
// receipt.result="SUCCESS" (non-default, value=1). Native TRX transfers emit no receipt at all.
// Known failure codes verified against Tron protocol and live mainnet responses.
const TRON_RECEIPT_FAILURE_RESULTS = new Set([
  'FAILED',
  'OUT_OF_ENERGY',
  'REVERT',
  'OUT_OF_TIME',
  'BANDWIDTH_ERROR',
  'ACCOUNT_FREEZED',
])

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
    // Present on both success ("SUCCESS") and failure. Absent only for native TRX transfers
    // where no smart contract executed. Known failure values: FAILED, OUT_OF_ENERGY, REVERT,
    // OUT_OF_TIME, BANDWIDTH_ERROR, ACCOUNT_FREEZED. Successful TRC20 calls emit "SUCCESS".
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

  // 1. top-level result === "FAILED" → error
  //    Tron RPC only emits "FAILED" here — no "SUCCESS" counterpart exists at the top level.
  //    iOS ref: `if let topLevelResult = response.data.result, topLevelResult == "FAILED"`
  //    (TronTransactionStatusProvider.swift:41 — same guard, same single-value invariant)
  if (tx.result === 'FAILED') {
    return { status: 'error' }
  }

  // 2. receipt absent → pending (native TRX transfers or tx still processing)
  if (!tx.receipt) {
    return { status: 'pending' }
  }

  // 3. receipt.result in terminal failure set → error
  //    receipt.result == null → success (native TRX send, no contract result)
  //    receipt.result == 'SUCCESS' → success (TRC20/smart-contract success, protobuf3 non-default enum)
  //    receipt.result unknown → treat as success (safer than false-failure for user)
  const status = tx.receipt.result != null && TRON_RECEIPT_FAILURE_RESULTS.has(tx.receipt.result) ? 'error' : 'success'
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
