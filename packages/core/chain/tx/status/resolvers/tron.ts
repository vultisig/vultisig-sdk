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
//
// sdk#1505 should-fix (S1): the allowlist-inversion below correctly means an UNKNOWN result
// never reads as false-success, but an unlisted contractResult still resolves 'pending' until
// the poll times out rather than promptly 'error'. The codes below complete the documented
// core/Tron.proto contractResult enum (every non-DEFAULT, non-SUCCESS member: values 2-16) so
// every KNOWN failure surfaces immediately instead of waiting out the poll. Kept in exact
// parity with the app's TRON_TERMINAL_FAILURE_RESULTS (vultiagent-app txVerifier.ts, app#2198)
// so a Tron failure buckets identically in the SDK resolver and the app tx-verifier.
const TRON_RECEIPT_FAILURE_RESULTS = new Set([
  'FAILED',
  'OUT_OF_ENERGY',
  'REVERT',
  'OUT_OF_TIME',
  'BANDWIDTH_ERROR',
  'ACCOUNT_FREEZED',
  'TRANSFER_FAILED',
  'BAD_JUMP_DESTINATION',
  'OUT_OF_MEMORY',
  'STACK_OVERFLOW',
  'STACK_TOO_SMALL',
  'STACK_TOO_LARGE',
  'ILLEGAL_OPERATION',
  'PRECOMPILED_CONTRACT',
  'JVM_STACK_OVER_FLOW',
  'UNKNOWN',
  'INVALID_CODE',
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

  if (error || !tx) {
    return { status: 'pending', isKnown: false }
  }

  if (!tx.id) {
    return { status: 'not_found', isKnown: false }
  }

  if (tx.blockNumber === undefined || tx.blockNumber === 0) {
    return { status: 'pending', isKnown: true }
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
    return { status: 'pending', isKnown: true }
  }

  const feeCoin = chainFeeCoin[Chain.Tron]
  const receipt =
    tx.fee != null
      ? {
          feeAmount: BigInt(tx.fee),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  // 3. receipt.result decides success vs failure vs unknown - an ALLOWLIST, not a deny-list:
  //    - in the known terminal failure set → error
  //    - null → success (native TRX send, no contract result)
  //    - 'SUCCESS' → success (TRC20/smart-contract success, protobuf3 non-default enum;
  //      pinned against NeO's live mainnet tx 1540b1b3, see tron.test.ts)
  //    - anything else (a receipt.result value we've never seen) → pending, NEVER success.
  //      The block is already final at this point, so this isn't "still processing" - it's an
  //      unrecognized terminal outcome, and a new Tron enum value must not be silently narrated
  //      as a successful fund movement just because it isn't on the known-failure list.
  if (tx.receipt.result != null && TRON_RECEIPT_FAILURE_RESULTS.has(tx.receipt.result)) {
    return { status: 'error', receipt }
  }

  if (tx.receipt.result == null || tx.receipt.result === 'SUCCESS') {
    return { status: 'success', receipt }
  }

  return { status: 'pending', isKnown: true, receipt }
}
