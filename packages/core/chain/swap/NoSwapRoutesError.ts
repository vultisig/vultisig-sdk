import { SwapError, SwapErrorCode } from './SwapError'

export class NoSwapRoutesError extends SwapError {
  constructor() {
    super(SwapErrorCode.NoRoutesFound, `No swap routes found.`)
  }
}
