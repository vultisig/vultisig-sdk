import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

const subscanExtrinsicUrl = 'https://assethub-polkadot.api.subscan.io/api/scan/extrinsic'

type SubscanExtrinsicResponse = {
  code: number
  message: string
  data: {
    hash: string
    success: boolean
    finalized: boolean
    fee?: string
    fee_used?: string
  } | null
}

export const getPolkadotTxStatus: TxStatusResolver<OtherChain.Polkadot> = async ({ hash }) => {
  const { data: response, error } = await attempt(
    queryUrl<SubscanExtrinsicResponse>(subscanExtrinsicUrl, {
      body: { hash },
    })
  )

  if (error || !response || response.code !== 0 || !response.data) {
    // Subscan does not know this hash (or the API errored). Mark
    // `isKnown: false` so the verify-by-hash safety net does NOT swallow
    // the original broadcast error. Otherwise an `author_submitExtrinsic`
    // rejection is silently reported as success and the UI shows a fake
    // "done" with a hash that has no on-chain counterpart. Mirrors
    // ripple.ts:25 / solana.ts:19.
    return { status: 'pending', isKnown: false }
  }

  const { success, finalized, fee_used } = response.data

  if (!finalized) {
    // Subscan has indexed the extrinsic but it is not finalized yet —
    // genuinely in flight. This is the legitimate peer-race case where
    // verify-by-hash should swallow the slower device's duplicate error.
    return { status: 'pending', isKnown: true }
  }

  const feeCoin = chainFeeCoin[Chain.Polkadot]
  const feeAmount = fee_used ?? response.data.fee
  const receipt =
    feeAmount != null && feeAmount !== ''
      ? {
          feeAmount: BigInt(feeAmount),
          feeDecimals: feeCoin.decimals,
          feeTicker: feeCoin.ticker,
        }
      : undefined

  return {
    status: success ? 'success' : 'error',
    receipt,
  }
}
