import { SwapDiscount } from '../discount/SwapDiscount'
import { GeneralSwapQuote } from '../general/GeneralSwapQuote'
import { NativeSwapQuote } from '../native/NativeSwapQuote'

export type SwapType = 'native' | 'general'

type SwapQuoteMap = {
  native: NativeSwapQuote
  general: GeneralSwapQuote
}

export type SwapQuoteResult = {
  [T in SwapType]: { [K in T]: SwapQuoteMap[T] }
}[SwapType]

export type SwapQuote = {
  quote: SwapQuoteResult
  discounts: SwapDiscount[]
  /**
   * The source-chain base-unit amount `findSwapQuote` actually fetched this quote
   * for. Optional (not every hand-built `SwapQuote` fixture sets it) so callers
   * that have it can cross-check the amount they're about to sign against the
   * amount the quote was computed for — the only reliable amount-consistency
   * signal available for native/EVM/Solana routes, whose quote responses carry
   * no committed-input-amount field of their own (ABTS/plan 005 residual).
   */
  requestedAmount?: bigint
}
