/** Catchable signal that the caller should fetch a fresh quote and retry. */
export class SwapQuoteExpiredError extends Error {
  readonly code = 'SWAP_QUOTE_EXPIRED'

  constructor(message: string) {
    super(message)
    this.name = 'SwapQuoteExpiredError'
  }
}
