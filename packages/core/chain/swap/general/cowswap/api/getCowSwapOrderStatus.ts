import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CowSwapOrderStatusResponse } from '../types'

type GetCowSwapOrderStatusInput = {
  apiBase: string
  uid: string
}

/** GET /api/v1/orders/{uid} — poll order status. */
export async function getCowSwapOrderStatus({
  apiBase,
  uid,
}: GetCowSwapOrderStatusInput): Promise<CowSwapOrderStatusResponse> {
  const raw = await queryUrl<{ status: string; txHash?: string; executedBuyAmount?: string }>(
    `${apiBase}/api/v1/orders/${uid}`
  )

  return {
    status: raw.status as CowSwapOrderStatusResponse['status'],
    txHash: raw.txHash,
    executedBuyAmount: raw.executedBuyAmount,
  }
}
