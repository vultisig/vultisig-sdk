import { NativeSwapChain } from './NativeSwapChain'

export type NativeSwapQuote = {
  swapChain: NativeSwapChain
  dust_threshold?: string
  expected_amount_out: string
  expiry: number
  fees: NativeSwapFees
  inbound_address?: string
  inbound_confirmation_blocks?: number
  inbound_confirmation_seconds?: number
  memo: string
  notes: string
  outbound_delay_blocks: number
  outbound_delay_seconds: number
  recommended_min_amount_in: string
  liquidity_tolerance_bps?: number
  max_streaming_quantity?: number
  total_swap_seconds?: number
  warning: string
  router?: string
}

type NativeSwapFees = {
  affiliate: string
  asset: string
  outbound: string
  total: string
  /**
   * Price impact of the swap, in basis points. This is the slippage alone —
   * distinct from `total_bps`, which is the total fee relative to the amount
   * out and merely looks like it.
   */
  slippage_bps?: number
  total_bps?: number
}
