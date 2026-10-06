import { Chain, OtherChain } from '@vultisig/core-chain/Chain'
import { chainFeeCoin } from '@vultisig/core-chain/coin/chainFeeCoin'
import { attempt } from '@vultisig/lib-utils/attempt'
import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { TxStatusResolver } from '../resolver'

// Subscan requires an API key, which the SDK does not send. Unauthenticated
// calls return `{ code: 403 }` and therefore resolve to unknown `pending`.
// A configurable key or node-RPC lookup is required before this resolver can
// report any production lookup as something other than `pending`.
const subscanExtrinsicUrl = 'https://assethub-polkadot.api.subscan.io/api/scan/extrinsic'

type SubscanExtrinsicResponse = {
  code: number
  message: string
  data: {
    // Subscan response schema: https://support.subscan.io/api-36911038
    extrinsic_hash: string
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

  if (error || !response || response.code !== 0) {
    return { status: 'pending', isKnown: false }
  }

  // A successful Subscan response with null data means no indexed extrinsic matched.
  if (response.data === null) return { status: 'not_found', isKnown: false }

  if (
    typeof response.data !== 'object' ||
    typeof response.data.extrinsic_hash !== 'string' ||
    typeof response.data.success !== 'boolean' ||
    typeof response.data.finalized !== 'boolean'
  ) {
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
