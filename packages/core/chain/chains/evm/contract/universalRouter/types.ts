/**
 * Aggregate swap intent extracted from a Uniswap Universal Router
 * `execute(bytes commands, bytes[] inputs, ...)` calldata.
 *
 * Addresses are lowercase hex strings. Native ETH is represented by the zero
 * address (see `NATIVE_TOKEN_ADDRESS`) — callers should translate that to the
 * chain's fee coin when displaying.
 */
export type UniversalRouterSwapIntent = {
  fromToken: string
  toToken: string
  /**
   * For exact-in flows: the user-supplied amountIn.
   * For exact-out flows: the amountInMax (upper bound the user authorized).
   */
  amountIn: bigint
  /**
   * For exact-in flows: the amountOutMin (floor the user accepted).
   * For exact-out flows: the amountOut the user is swapping to.
   */
  amountOutMin: bigint
  isExactOut: boolean
}
