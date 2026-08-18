export enum SwapErrorCode {
  /** No swap provider supports this chain pair - swap cannot be attempted at all */
  NoRoutesFound = 'SWAP_NO_ROUTES_FOUND',
  /** Amount is below the dust threshold of one or more providers */
  AmountTooSmall = 'SWAP_AMOUNT_TOO_SMALL',
  /** Amount is below a provider's minimum but above dust - provider surfaced an explicit min */
  AmountBelowMinimum = 'SWAP_AMOUNT_BELOW_MINIMUM',
  /** All configured providers were attempted and all failed */
  AllProvidersFailed = 'SWAP_ALL_PROVIDERS_FAILED',
  /** Trading for this pair is temporarily halted by the provider (not an amount problem) */
  TradingHalted = 'SWAP_TRADING_HALTED',
  /** Caller passed invalid configuration (e.g. mixed-case THORName affiliateFeeAddress) */
  InvalidConfig = 'SWAP_INVALID_CONFIG',
}

/**
 * Structured detail attached to `AmountBelowMinimum`/`AmountTooSmall` errors so
 * a consumer can act on the exact threshold instead of re-deriving it from a
 * second native-quote fetch. `nativeMin` mirrors THORChain/Maya's own
 * `recommended_min_amount_in` economics (see `getNativeSwapMinAmountIn`), in
 * the `from` coin's base units — the same shape whether the threshold was
 * computed proactively or surfaced by a provider rejection.
 */
export type SwapErrorMetadata = {
  nativeMin?: {
    swapChain: string
    minAmountInBaseUnits: bigint
    minAmountInHuman: string
  }
}

export class SwapError extends Error {
  readonly name = 'SwapError'

  constructor(
    public readonly code: SwapErrorCode,
    message: string,
    public readonly metadata?: SwapErrorMetadata
  ) {
    super(message)
  }
}
