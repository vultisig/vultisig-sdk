import {
  type ExactInQueryOutput,
  type ExactOutQueryOutput,
  type Path,
  Slippage,
  Swap,
  SwapKind,
  Token,
  TokenAmount,
  ZERO_ADDRESS,
} from '@balancer/sdk'
import { getAddress, isAddress } from 'viem'

/**
 * Build UNSIGNED Balancer v3 swap calldata (Vault / BatchRouter encoding).
 *
 * This is a PURE calldata builder. It never signs, never broadcasts, and never
 * touches an RPC. It thinly WRAPS `@balancer/sdk` (viem-only, RN-safe) to encode
 * the v3 BatchRouter `swapExactIn` / `swapExactOut` transaction for a route that
 * was already quoted off-chain (e.g. via the Balancer SOR — see the
 * `get_balancer_v3_quote` mcp-ts tool — or via `@balancer-labs/balancer-maths`).
 *
 * The consumer passes the SOR path(s) + the expected amounts; the SDK constructs
 * the offline `queryOutput` and applies slippage to produce a min-out / max-in
 * bound, then hands back `{ to, data, value }` ready for the wallet/MPC layer to
 * sign. Only the unsigned-tx builder is exposed — `@balancer/sdk`'s signing /
 * permit2-signature helpers are deliberately NOT re-exported.
 */

export type BalancerTokenApi = {
  /** Token contract address on the selected chain. */
  address: string
  /** Token decimals. */
  decimals: number
}

/**
 * A single Balancer v3 swap path, shaped to match the SOR `sorGetSwapPaths`
 * response (and `@balancer/sdk`'s `Path`). `pools` and `tokens` are ordered
 * input -> output; `tokens.length === pools.length + 1`.
 */
export type BalancerV3SwapPath = {
  /** Ordered pool addresses (or pool ids) for the hop chain. */
  pools: string[]
  /** Ordered token hops, input first, output last. */
  tokens: BalancerTokenApi[]
  /** Raw (base-unit) input amount for this path. */
  inputAmountRaw: bigint
  /** Raw (base-unit) output amount for this path. */
  outputAmountRaw: bigint
  /** Per-pool buffer flags (ERC-4626 boosted hops). Defaults to all-false. */
  isBuffer?: boolean[]
}

export type BalancerV3SwapKind = 'EXACT_IN' | 'EXACT_OUT'

export type BuildBalancerV3SwapCalldataParams = {
  /** EVM chain id (e.g. 1 mainnet, 8453 base, 42161 arbitrum). */
  chainId: number
  /** EXACT_IN spends a fixed input; EXACT_OUT receives a fixed output. */
  swapKind: BalancerV3SwapKind
  /** Quoted swap path(s) from the SOR (single- or multi-path/batch). */
  paths: BalancerV3SwapPath[]
  /**
   * Expected output (EXACT_IN) or expected input (EXACT_OUT), raw base units,
   * as returned by the off-chain quote. Slippage is applied to this to derive
   * the on-chain min-out / max-in bound.
   */
  expectedAmountRaw: bigint
  /**
   * Slippage tolerance in basis points (e.g. 50 = 0.5%). Required, no default —
   * the consumer owns the risk decision. Must be a non-negative integer.
   */
  slippageBps: number
  /** Address that receives the output tokens. */
  recipient: string
  /**
   * Unix-seconds deadline for the swap. Optional; when omitted the BatchRouter
   * default (no deadline) is used.
   */
  deadline?: bigint
  /**
   * When true, wrap/unwrap native <-> wrapped native as part of the swap.
   * Defaults to false.
   */
  wethIsEth?: boolean
  /**
   * INJECTABLE passthrough hex appended to the BatchRouter call as `userData`.
   * This is the multi-consumer extension point (affiliate / referral / hook
   * payloads where a pool hook consumes it). Defaults to `0x` (neutral / off).
   * The SDK NEVER injects a consumer-specific value of its own.
   */
  userData?: `0x${string}`
}

export type BalancerV3SwapCalldata = {
  /** Target contract for the unsigned tx (the Balancer v3 BatchRouter). */
  to: `0x${string}`
  /** ABI-encoded calldata for the swap. */
  data: `0x${string}`
  /** Native value to send (non-zero only for native-in swaps). */
  value: bigint
  /**
   * The account that MUST originate (and therefore receive) this swap. The v3
   * BatchRouter settles to msg.sender, so the signing account has to equal this.
   */
  account: `0x${string}`
  /** Resolved swap kind. */
  swapKind: BalancerV3SwapKind
  /** EXACT_IN: slippage-adjusted minimum output, raw base units. */
  minAmountOutRaw?: bigint
  /** EXACT_OUT: slippage-adjusted maximum input, raw base units. */
  maxAmountInRaw?: bigint
}

const requireAddress = (field: string, value: string): `0x${string}` => {
  if (!isAddress(value)) {
    throw new Error(`${field} must be a valid 0x-prefixed EVM address (got "${value}")`)
  }
  return getAddress(value)
}

const toTokenApi = (token: BalancerTokenApi): { address: `0x${string}`; decimals: number } => {
  if (!Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36) {
    throw new Error(`token decimals must be an integer in [0, 36] (got ${token.decimals})`)
  }
  return { address: requireAddress('token address', token.address), decimals: token.decimals }
}

const toSdkPath = (path: BalancerV3SwapPath): Path => {
  if (path.tokens.length < 2) {
    throw new Error('each path needs at least 2 tokens (input + output)')
  }
  if (path.pools.length !== path.tokens.length - 1) {
    throw new Error('pools.length must equal tokens.length - 1')
  }
  if (path.inputAmountRaw <= 0n || path.outputAmountRaw <= 0n) {
    throw new Error('path inputAmountRaw and outputAmountRaw must be positive')
  }
  const isBuffer = path.isBuffer ?? path.pools.map(() => false)
  if (isBuffer.length !== path.pools.length) {
    throw new Error('isBuffer.length must equal pools.length')
  }
  return {
    protocolVersion: 3,
    pools: path.pools.map(pool => requireAddress('pool', pool)),
    tokens: path.tokens.map(toTokenApi),
    inputAmountRaw: path.inputAmountRaw,
    outputAmountRaw: path.outputAmountRaw,
    isBuffer,
  }
}

/**
 * Construct the offline `queryOutput` the BatchRouter builder needs, from the
 * off-chain quote, so no RPC call is required.
 */
const buildOfflineQueryOutput = (
  swap: Swap,
  chainId: number,
  swapKind: SwapKind,
  paths: BalancerV3SwapPath[],
  expectedAmountRaw: bigint
): ExactInQueryOutput | ExactOutQueryOutput => {
  const firstPath = paths[0]
  const lastPath = paths[paths.length - 1]
  const inputToken = firstPath.tokens[0]
  const outputToken = lastPath.tokens[lastPath.tokens.length - 1]

  const inToken = new Token(chainId, requireAddress('token address', inputToken.address), inputToken.decimals)
  const outToken = new Token(chainId, requireAddress('token address', outputToken.address), outputToken.decimals)

  // `QueryOutputBase.to` is a required field but `buildCall` resolves the router
  // address internally from chainId/protocolVersion and ignores this value. Pass
  // ZERO_ADDRESS as an explicit sentinel instead of reaching into private internals
  // via an `as unknown` cast. The router address is asserted non-zero after buildCall.
  if (swapKind === SwapKind.GivenIn) {
    const amountIn = paths.reduce((acc, p) => acc + p.inputAmountRaw, 0n)
    return {
      swapKind: SwapKind.GivenIn,
      to: ZERO_ADDRESS,
      amountIn: TokenAmount.fromRawAmount(inToken, amountIn),
      expectedAmountOut: TokenAmount.fromRawAmount(outToken, expectedAmountRaw),
    }
  }

  const amountOut = paths.reduce((acc, p) => acc + p.outputAmountRaw, 0n)
  return {
    swapKind: SwapKind.GivenOut,
    to: ZERO_ADDRESS,
    amountOut: TokenAmount.fromRawAmount(outToken, amountOut),
    expectedAmountIn: TokenAmount.fromRawAmount(inToken, expectedAmountRaw),
  }
}

export const buildBalancerV3SwapCalldata = (params: BuildBalancerV3SwapCalldataParams): BalancerV3SwapCalldata => {
  const {
    chainId,
    swapKind: swapKindInput,
    paths,
    expectedAmountRaw,
    slippageBps,
    recipient,
    deadline,
    wethIsEth = false,
    userData = '0x',
  } = params

  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`chainId must be a positive integer (got ${chainId})`)
  }
  if (!paths.length) {
    throw new Error('at least one swap path is required')
  }
  if (expectedAmountRaw <= 0n) {
    throw new Error('expectedAmountRaw must be positive')
  }
  if (!Number.isInteger(slippageBps) || slippageBps < 0) {
    throw new Error(`slippageBps must be a non-negative integer (got ${slippageBps})`)
  }
  if (!/^0x([0-9a-fA-F]{2})*$/.test(userData)) {
    throw new Error('userData must be 0x-prefixed even-length hex')
  }
  if (swapKindInput !== 'EXACT_IN' && swapKindInput !== 'EXACT_OUT') {
    throw new Error(`swapKind must be "EXACT_IN" or "EXACT_OUT" (got "${swapKindInput}")`)
  }

  // Validate that every path shares the same input and output token. Multi-path
  // Balancer swaps aggregate amounts across parallel routes for a single token
  // pair. Mixed-pair paths would encode cross-asset amounts into the wrong slots.
  const firstInputAddr = getAddress(paths[0].tokens[0].address)
  const firstOutputAddr = getAddress(paths[0].tokens[paths[0].tokens.length - 1].address)
  for (let i = 1; i < paths.length; i++) {
    const p = paths[i]
    if (getAddress(p.tokens[0].address) !== firstInputAddr) {
      throw new Error(
        `path[${i}] input token (${p.tokens[0].address}) differs from path[0] input token (${firstInputAddr}); all paths must share the same token pair`
      )
    }
    if (getAddress(p.tokens[p.tokens.length - 1].address) !== firstOutputAddr) {
      throw new Error(
        `path[${i}] output token (${p.tokens[p.tokens.length - 1].address}) differs from path[0] output token (${firstOutputAddr}); all paths must share the same token pair`
      )
    }
  }

  const swapKind = swapKindInput === 'EXACT_OUT' ? SwapKind.GivenOut : SwapKind.GivenIn

  // FUND-SAFETY: the on-chain slippage floor/cap (minAmountOut / maxAmountIn) is
  // derived ENTIRELY from `expectedAmountRaw`, a scalar that is DECOUPLED from the
  // per-path amounts that actually get ABI-encoded into the calldata. If a caller
  // (transcription bug, human-vs-raw units mismatch, or a compromised quote) hands
  // an `expectedAmountRaw` that drifts in the UNSAFE direction, the builder would
  // happily emit calldata whose protection bound looks plausible but is meaningless:
  //   - EXACT_IN: a reference OUTPUT below the encoded expected output => an
  //     artificially LOW min-out floor (user can be sandwiched for ~free).
  //   - EXACT_OUT: a reference INPUT above the encoded expected input => an
  //     artificially HIGH max-in cap (user can be made to overpay).
  // The SOR returns the reference amount and the per-path amounts TOGETHER, so in
  // the honest case they're equal; we only reject the unsafe-direction drift and
  // leave the safe direction (a stricter-than-quoted bound) alone.
  if (swapKind === SwapKind.GivenIn) {
    const encodedOutputSum = paths.reduce((acc, p) => acc + p.outputAmountRaw, 0n)
    if (expectedAmountRaw < encodedOutputSum) {
      throw new Error(
        `EXACT_IN expectedAmountRaw (${expectedAmountRaw}) must be >= the encoded path output sum ` +
          `(${encodedOutputSum}); a smaller reference silently produces an unsafe min-out floor`
      )
    }
  } else {
    const encodedInputSum = paths.reduce((acc, p) => acc + p.inputAmountRaw, 0n)
    if (expectedAmountRaw > encodedInputSum) {
      throw new Error(
        `EXACT_OUT expectedAmountRaw (${expectedAmountRaw}) must be <= the encoded path input sum ` +
          `(${encodedInputSum}); a larger reference silently produces an unsafe max-in cap`
      )
    }
  }

  // Validate recipient eagerly even though Balancer v3's BatchRouter settles to
  // msg.sender (no sender/recipient args). We surface it on the result so the
  // wallet/MPC layer knows which account must originate + receive the swap.
  const recipientAddress = requireAddress('recipient', recipient)

  const swap = new Swap({
    chainId,
    swapKind,
    paths: paths.map(toSdkPath),
    userData,
  })

  const queryOutput = buildOfflineQueryOutput(swap, chainId, swapKind, paths, expectedAmountRaw)

  // Balancer v3 BatchRouter swaps from/to msg.sender, so we deliberately do NOT
  // pass sender/recipient here (those are v2-only and rejected by the v3 path).
  const built = swap.buildCall({
    slippage: Slippage.fromBasisPoints(`${slippageBps}`),
    deadline,
    wethIsEth,
    queryOutput,
  })

  // Assert buildCall resolved a real router address. The queryOutput.to sentinel
  // (ZERO_ADDRESS) is ignored internally; if the SDK ever breaks this contract the
  // unsigned tx would target the zero address and drain funds on broadcast.
  if (!isAddress(built.to) || built.to === ZERO_ADDRESS) {
    throw new Error(`Balancer buildCall returned an invalid router address: ${built.to}`)
  }

  const base: BalancerV3SwapCalldata = {
    to: built.to,
    data: built.callData,
    value: built.value,
    account: recipientAddress,
    swapKind: swapKindInput,
  }

  if ('minAmountOut' in built) {
    return { ...base, minAmountOutRaw: built.minAmountOut.amount }
  }
  return { ...base, maxAmountInRaw: built.maxAmountIn.amount }
}
