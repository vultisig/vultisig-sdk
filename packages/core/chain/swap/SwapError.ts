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

export class SwapError extends Error {
  readonly name = 'SwapError'

  constructor(
    public readonly code: SwapErrorCode,
    message: string
  ) {
    super(message)
  }
}
