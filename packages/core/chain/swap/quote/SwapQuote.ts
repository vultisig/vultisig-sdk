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
  /** Source amount, in base units, bound by `findSwapQuote`. Absent on legacy/manually constructed quotes. */
  requestedAmount?: bigint
  /** Absolute quote expiry in milliseconds, bound by `findSwapQuote`. Absent on legacy/manually constructed quotes. */
  expiresAt?: number
  /** Mutation/stale-reuse binding for the request identity, expiry, and exact returned transaction. */
  safetyFingerprint?: string
}

/**
 * A canonical quote returned by `findSwapQuote`, with fund-safety metadata
 * present. Keep this as the live returned object (structured cloning is safe);
 * JSON round-tripping loses required runtime value types such as `bigint`.
 */
export type BoundSwapQuote = SwapQuote &
  Required<Pick<SwapQuote, 'requestedAmount' | 'expiresAt' | 'safetyFingerprint'>>
