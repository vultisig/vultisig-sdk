/**
 * On-chain Balancer pool quote via canonical pool math.
 *
 * Uses `@balancer-labs/balancer-maths` (zero-dep, RN-safe, the same math the
 * Balancer SOR + on-chain Vault use) rather than hand-rolling the weighted /
 * stable invariant. We only supply the on-chain pool state (balances, weights,
 * swap fee, scaling factors) and let the canonical `Vault.swap()` compute the
 * exact amount out.
 *
 * Read-only: pure math over a pool state the caller has read from chain. Does
 * NOT build calldata, does NOT sign, does NOT broadcast.
 */
import { type PoolState, SwapKind,Vault } from '@balancer-labs/balancer-maths'
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
