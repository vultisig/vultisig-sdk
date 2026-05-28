import { Chain } from '@vultisig/core-chain/Chain'

/** No SwapKit provider returned an eligible route for the requested swap. */
export class SwapKitNoEligibleRoutesError extends Error {
  constructor() {
    super('SwapKit returned no eligible routes.')
  }
}

/**
 * The SwapKit pair is structurally supported (per the cached `/providers`
 * snapshot) but no route was returned — i.e. the amount is below the provider
 * minimum. Synthetic: never decoded from a SwapKit response, only raised by
 * `getSwapKitQuote` after the pair cross-check. Mirrors vultisig-ios #4418.
 */
export class SwapKitAmountBelowMinimumError extends Error {
  constructor(
    readonly fromChain: Chain,
    readonly toChain: Chain
  ) {
    super(`SwapKit amount below provider minimum for ${fromChain} -> ${toChain}.`)
  }
}
