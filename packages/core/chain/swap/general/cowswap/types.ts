export type CowSwapOrderKind = 'sell' | 'buy'

/** Raw CowSwap quote object returned by POST /api/v1/quote */
export type CowSwapQuoteObject = {
  sellToken: string
  buyToken: string
  receiver: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  feeAmount: string
  kind: CowSwapOrderKind
  partiallyFillable: boolean
  sellTokenBalance: string
  buyTokenBalance: string
}

/** Full response envelope from POST /api/v1/quote */
export type CowSwapQuoteApiResponse = {
  quote: CowSwapQuoteObject
  from: string
  expiration: string
  id: number
}

/** Status returned by GET /api/v1/orders/{uid} */
export type CowSwapOrderStatus = 'open' | 'filled' | 'cancelled' | 'expired'

export type CowSwapOrderStatusResponse = {
  status: CowSwapOrderStatus
  txHash?: string
  executedBuyAmount?: string
}
