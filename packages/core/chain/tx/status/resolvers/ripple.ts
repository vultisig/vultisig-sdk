import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { getRippleClient } from '@vultisig/core-chain/chains/ripple/client'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'

import { TxStatusResolver } from '../resolver'

export const getRippleTxStatus: TxStatusResolver<OtherChain.Ripple> = async ({
  hash,
}) => {
  const client = await getRippleClient()

  const { data: response, error } = await attempt(
    client.request({
      command: 'tx',
      transaction: hash,
    })
  )

  if (error || !response) {
    // The chain says it doesn't know this hash — either the tx was
    // rejected at preflight and never made it on-chain, or there's a
    // transient RPC error. Either way, mark `isKnown: false` so the
    // verify-by-hash safety net does NOT swallow broadcast errors for
    // this case. Mirrors `solana.ts:19`. The status itself stays
    // `'pending'` so status-polling UI can re-query later.
    return { status: 'pending', isKnown: false }
  }

  const { validated, meta, tx_json } = response.result as {
    validated?: boolean
    meta?: { TransactionResult?: string }
    tx_json?: { Fee?: string }
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

  // Genuinely in the ledger but not yet validated — XRPL knows about it.
  return { status: 'pending', isKnown: true }
}
