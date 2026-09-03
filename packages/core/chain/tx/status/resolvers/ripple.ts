import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxReceiptInfo, TxStatusResolver } from '../resolver'

const getDeliveredReceipt = (meta: Record<string, unknown>): Partial<TxReceiptInfo> => {
  const deliveredAmount = 'delivered_amount' in meta ? meta.delivered_amount : meta.DeliveredAmount

  if (typeof deliveredAmount === 'string') {
    return /^\d+$/.test(deliveredAmount)
      ? {
          deliveredAmount,
          deliveredCurrency: 'XRP',
        }
      : {}
  }

  if (!deliveredAmount || typeof deliveredAmount !== 'object') {
    return {}
  }

  const { value, currency, issuer, mpt_issuance_id: mptIssuanceId } = deliveredAmount as Record<string, unknown>
  if ('mpt_issuance_id' in deliveredAmount) {
    if (
      typeof value === 'string' &&
      /^\d{1,19}$/.test(value) &&
      BigInt(value) <= 9_223_372_036_854_775_807n &&
      typeof mptIssuanceId === 'string' &&
      /^[A-F0-9]{48}$/i.test(mptIssuanceId) &&
      currency === undefined &&
      issuer === undefined
    ) {
      return {
        deliveredAmount: value,
        deliveredMptIssuanceId: mptIssuanceId,
      }
    }

    return {}
  }

  if (
    typeof value !== 'string' ||
    !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) ||
    typeof currency !== 'string' ||
    !currency ||
    typeof issuer !== 'string' ||
    !issuer
  ) {
    return {}
  }

  return {
    deliveredAmount: value,
    deliveredCurrency: currency,
    deliveredIssuer: issuer,
  }
}

export const getRippleTxStatus: TxStatusResolver<OtherChain.Ripple> = async ({ hash }) => {
  const client = await getRippleClient()

  const { data: response, error } = await attempt(
    client.request({
      command: 'tx',
      transaction: hash,
    })
  )

  if (error || !response || typeof response.result !== 'object' || response.result === null) {
    // The chain says it doesn't know this hash, OR the response is
    // shaped unexpectedly (e.g. malformed payload `{}` without `result`).
    // Either case: mark `isKnown: false` so the verify-by-hash safety
    // net does NOT swallow broadcast errors. Mirrors `solana.ts:19`.
    // Status itself stays `'pending'` so status-polling UI can re-query
    // later.
    return { status: 'pending', isKnown: false }
  }

  const { validated, meta, tx_json } = response.result as {
    validated?: boolean
    meta?: { TransactionResult?: string; delivered_amount?: unknown; DeliveredAmount?: unknown }
    tx_json?: { Fee?: string; TransactionType?: string }
  }

  if (validated) {
    const success =
      typeof meta === 'object' &&
      meta !== null &&
      'TransactionResult' in meta &&
      meta.TransactionResult === 'tesSUCCESS'

    const status = success ? 'success' : 'error'
    const feeStr = tx_json?.Fee
    const feeCoin = chainFeeCoin[Chain.Ripple]
    const deliveredReceipt = success && tx_json?.TransactionType === 'Payment' ? getDeliveredReceipt(meta) : {}
    const receipt =
      feeStr != null && feeStr !== ''
        ? {
            feeAmount: BigInt(feeStr),
            feeDecimals: feeCoin.decimals,
            feeTicker: feeCoin.ticker,
            ...deliveredReceipt,
          }
        : undefined

    return { status, receipt }
  }

  // Genuinely in the ledger but not yet validated — XRPL knows about it.
  return { status: 'pending', isKnown: true }
}
