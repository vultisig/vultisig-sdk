import { EvmChain } from '@vultisig/core-chain/Chain'
import { getEvmClient } from '@vultisig/core-chain/chains/evm/client'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { TransactionNotFoundError, TransactionReceiptNotFoundError } from 'viem'

import { TxStatusResolver } from '../resolver'

export const getEvmTxStatus: TxStatusResolver<EvmChain> = async ({ chain, hash }) => {
  const client = getEvmClient(chain)

  const { data, error } = await attempt(client.getTransactionReceipt({ hash: hash as `0x${string}` }))

  if (data) {
    const status = data.status === 'success' ? 'success' : 'error'
    const feeCoin = chainFeeCoin[chain]

    const receipt =
      data.gasUsed != null && data.effectiveGasPrice != null
        ? {
            feeAmount: data.gasUsed * data.effectiveGasPrice,
            feeDecimals: feeCoin.decimals,
            feeTicker: feeCoin.ticker,
          }
        : undefined

    return { status, receipt }
  }

  // No receipt. A missing receipt on its own can't distinguish "still pending in
  // the mempool" from "the node has never seen this hash" — so only treat the
  // receipt as *definitively* absent when viem says so. Any other failure is a
  // transient RPC error: report a non-terminal `pending` with `isKnown: false`
  // and let the caller's bounded polling decide when to give up.
  const receiptMissing = error instanceof TransactionReceiptNotFoundError || data === null
  if (!receiptMissing) {
    return { status: 'pending', isKnown: false }
  }

  // Receipt genuinely absent — ask the node whether it knows the tx at all.
  const { data: tx, error: txError } = await attempt(client.getTransaction({ hash: hash as `0x${string}` }))

  if (tx) {
    // The node has the tx (in the mempool, or mined but the receipt is lagging):
    // a true pending. `isKnown: true` so the broadcast-verify safety net trusts it.
    return { status: 'pending', isKnown: true }
  }

  if (txError instanceof TransactionNotFoundError || tx === null) {
    // The node has never seen this hash — terminal `not_found`, NOT `pending`, so
    // a malformed/dropped/typo'd hash is not polled forever.
    return { status: 'not_found', isKnown: false }
  }

  // Couldn't confirm not-found (transient error on getTransaction) — stay pending.
  return { status: 'pending', isKnown: false }
}
