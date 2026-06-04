import { queryUrl } from '@vultisig/lib-utils/query/queryUrl'

import { CowSwapOrder } from '../sign/buildCowSwapOrder'

type SubmitCowSwapOrderInput = {
  apiBase: string
  order: CowSwapOrder
  signature: string
  from: string
}

/** POST /api/v1/orders — submit a signed CowSwap order.
 * Returns the orderUid assigned by the API. */
export async function submitCowSwapOrder({
  apiBase,
  order,
  signature,
  from,
}: SubmitCowSwapOrderInput): Promise<string> {
  const body = {
    ...order,
    signature,
    signingScheme: 'eip712',
    from: from.toLowerCase(),
  }

  const orderUid = await queryUrl<string>(`${apiBase}/api/v1/orders`, {
    method: 'POST',
    body,
  })

  return orderUid
}
