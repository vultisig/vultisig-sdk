/**
 * Balancer pool quote via canonical pool math.
 *
 * Uses `@balancer-labs/balancer-maths` (zero-dep, RN-safe, the same math the
 * Balancer SOR + on-chain Vault use) rather than hand-rolling the weighted /
 * stable invariant. The canonical `Vault.swap()` computes the exact amount out.
 *
 * IMPORTANT — trust boundary: unlike `uniswapV2Quote` (which reads factory →
 * pair → reserves on-chain itself), this helper does NOT read chain state. It
 * is pure math over a `poolState` the CALLER must have read from chain. The
 * quote is only as trustworthy as the supplied state; a stale or attacker-
 * chosen `poolState` yields a stale/fake quote even though the math lib is
 * canonical. The caller owns pinning poolState to a chain/Vault/block.
 *
 * Read-only: pure math. Does NOT build calldata, sign, or broadcast.
 */
import { type PoolState, SwapKind, Vault } from '@balancer-labs/balancer-maths'
import { getAddress, isAddress } from 'viem'

export type BalancerSwapKind = 'EXACT_IN' | 'EXACT_OUT'

export type BalancerQuoteParams = {
  /**
   * Canonical Balancer pool state, as read from chain (balances are
   * live-scaled to 18 decimals, weights/fees in 1e18 fixed point). This is the
   * exact shape `@balancer-labs/balancer-maths` consumes — see its `PoolState`.
   */
  poolState: PoolState
  /** Input token address (0x-prefixed). */
  tokenIn: string
  /** Output token address (0x-prefixed). */
  tokenOut: string
  /**
   * Raw (base-unit) amount. For EXACT_IN this is the input token amount; for
   * EXACT_OUT it is the desired output token amount.
   */
  amountRaw: bigint
  /** Defaults to EXACT_IN. */
  swapKind?: BalancerSwapKind
}

export type BalancerQuote = {
  protocol: 'balancer'
  action: 'quote_swap'
  status: 'read_only'
  poolAddress: string
  poolType: string
  tokenIn: `0x${string}`
  tokenOut: `0x${string}`
  swapKind: BalancerSwapKind
  amountRaw: string
  /**
   * For EXACT_IN: computed output amount (raw). For EXACT_OUT: required input
   * amount (raw). Comes straight from the canonical Vault math.
   */
  resultRaw: string
}

/**
 * Compute a Balancer exact-in (or exact-out) quote from an on-chain pool
 * state using the canonical `@balancer-labs/balancer-maths` Vault. Supports
 * every pool type the lib supports (weighted, stable, gyro, reclamm, ...).
 */
export function balancerQuote(params: BalancerQuoteParams): BalancerQuote {
  const tokenInRaw = params.tokenIn.trim()
  const tokenOutRaw = params.tokenOut.trim()
  if (!isAddress(tokenInRaw)) throw new Error(`invalid tokenIn: "${params.tokenIn}".`)
  if (!isAddress(tokenOutRaw)) throw new Error(`invalid tokenOut: "${params.tokenOut}".`)

  const tokenIn = getAddress(tokenInRaw)
  const tokenOut = getAddress(tokenOutRaw)
  if (tokenIn === tokenOut) throw new Error('tokenIn and tokenOut must be different.')
  if (params.amountRaw <= 0n) throw new Error('amountRaw must be positive.')

  // Fail closed before computing: the caller-supplied poolState is the trust
  // boundary here (unlike uniswapV2Quote, this helper does no on-chain read of
  // its own — see the JSDoc above). Prove tokenIn/tokenOut are actually members
  // of the pool's token set, normalising case, so a malformed/stale/attacker
  // poolState that omits either token can't yield a plausible-but-fake quote.
  const poolTokens = (params.poolState.tokens ?? []).map(t => getAddress(t.trim()))
  if (!poolTokens.includes(tokenIn)) {
    throw new Error(`tokenIn ${tokenIn} is not a member of pool ${params.poolState.poolAddress}.`)
  }
  if (!poolTokens.includes(tokenOut)) {
    throw new Error(`tokenOut ${tokenOut} is not a member of pool ${params.poolState.poolAddress}.`)
  }

  const swapKind = params.swapKind ?? 'EXACT_IN'
  const kind = swapKind === 'EXACT_OUT' ? SwapKind.GivenOut : SwapKind.GivenIn

  const vault = new Vault()
  const resultRaw = vault.swap(
    {
      amountRaw: params.amountRaw,
      tokenIn,
      tokenOut,
      swapKind: kind,
    },
    params.poolState
  )

  return {
    protocol: 'balancer',
    action: 'quote_swap',
    status: 'read_only',
    poolAddress: params.poolState.poolAddress,
    poolType: params.poolState.poolType,
    tokenIn,
    tokenOut,
    swapKind,
    amountRaw: params.amountRaw.toString(),
    resultRaw: resultRaw.toString(),
  }
}

export type { PoolState as BalancerPoolState }
