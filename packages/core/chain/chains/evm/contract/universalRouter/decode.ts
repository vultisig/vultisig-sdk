import { AbiCoder, getBytes, hexlify, Interface } from 'ethers'

import {
  COMMAND_TYPE_MASK,
  CONTRACT_BALANCE_SENTINEL,
  NATIVE_TOKEN_ADDRESS,
  URCommand,
  V4Action,
} from './opcodes'
import { UniversalRouterSwapIntent } from './types'

/**
 * Universal Router exposes two `execute` variants — one with a deadline and
 * one without. Both take `(bytes commands, bytes[] inputs)` as the first two
 * arguments, which is all we need to decode swap intent.
 */
const UR_ABI = [
  'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
  'function execute(bytes commands, bytes[] inputs)',
]

const coder = AbiCoder.defaultAbiCoder()
const urInterface = new Interface(UR_ABI)

type SwapEntry = {
  fromToken: string
  toToken: string
  amountIn: bigint
  amountOutMin: bigint
  isExactOut: boolean
}

const normalize = (addr: string): string => addr.toLowerCase()

const firstAddressInV3Path = (path: string): string => {
  const bytes = getBytes(path)
  if (bytes.length < 20) return ''
  return normalize(hexlify(bytes.slice(0, 20)))
}

const lastAddressInV3Path = (path: string): string => {
  const bytes = getBytes(path)
  if (bytes.length < 20) return ''
  return normalize(hexlify(bytes.slice(bytes.length - 20)))
}

const safeDecode = <T>(fn: () => T): T | null => {
  try {
    return fn()
  } catch {
    return null
  }
}

const decodeV2Swap = (
  input: string,
  isExactOut: boolean
): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(
      ['address', 'uint256', 'uint256', 'address[]', 'bool'],
      input
    )
  )
  if (!decoded) return null
  const [, amountA, amountB, path] = decoded as unknown as [
    string,
    bigint,
    bigint,
    string[],
    boolean,
  ]
  if (!Array.isArray(path) || path.length < 2) return null
  const fromToken = normalize(path[0])
  const toToken = normalize(path[path.length - 1])
  return isExactOut
    ? {
        fromToken,
        toToken,
        amountIn: amountB,
        amountOutMin: amountA,
        isExactOut: true,
      }
    : {
        fromToken,
        toToken,
        amountIn: amountA,
        amountOutMin: amountB,
        isExactOut: false,
      }
}

const decodeV3Swap = (
  input: string,
  isExactOut: boolean
): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(['address', 'uint256', 'uint256', 'bytes', 'bool'], input)
  )
  if (!decoded) return null
  const [, amountA, amountB, path] = decoded as unknown as [
    string,
    bigint,
    bigint,
    string,
    boolean,
  ]
  const fromToken = firstAddressInV3Path(path)
  const toToken = lastAddressInV3Path(path)
  if (!fromToken || !toToken) return null
  // V3 encodes the path in swap direction for exact-in, and reversed for
  // exact-out (tokenOut first). Flip so that fromToken/toToken always match
  // the user's perspective.
  if (isExactOut) {
    return {
      fromToken: toToken,
      toToken: fromToken,
      amountIn: amountB,
      amountOutMin: amountA,
      isExactOut: true,
    }
  }
  return {
    fromToken,
    toToken,
    amountIn: amountA,
    amountOutMin: amountB,
    isExactOut: false,
  }
}

const POOL_KEY_TYPE =
  '(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)'
const PATH_KEY_TYPE =
  '(address intermediateCurrency, uint24 fee, int24 tickSpacing, address hooks, bytes hookData)'

const decodeV4ExactInSingle = (params: string): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(
      [
        `tuple(${POOL_KEY_TYPE} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)`,
      ],
      params
    )
  )
  if (!decoded) return null
  const [{ poolKey, zeroForOne, amountIn, amountOutMinimum }] =
    decoded as unknown as [
      {
        poolKey: { currency0: string; currency1: string }
        zeroForOne: boolean
        amountIn: bigint
        amountOutMinimum: bigint
      },
    ]
  const fromToken = normalize(zeroForOne ? poolKey.currency0 : poolKey.currency1)
  const toToken = normalize(zeroForOne ? poolKey.currency1 : poolKey.currency0)
  return {
    fromToken,
    toToken,
    amountIn,
    amountOutMin: amountOutMinimum,
    isExactOut: false,
  }
}

const decodeV4ExactIn = (params: string): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(
      [
        `tuple(address currencyIn, ${PATH_KEY_TYPE}[] path, uint128 amountIn, uint128 amountOutMinimum)`,
      ],
      params
    )
  )
  if (!decoded) return null
  const [{ currencyIn, path, amountIn, amountOutMinimum }] =
    decoded as unknown as [
      {
        currencyIn: string
        path: { intermediateCurrency: string }[]
        amountIn: bigint
        amountOutMinimum: bigint
      },
    ]
  if (!Array.isArray(path) || path.length === 0) return null
  return {
    fromToken: normalize(currencyIn),
    toToken: normalize(path[path.length - 1].intermediateCurrency),
    amountIn,
    amountOutMin: amountOutMinimum,
    isExactOut: false,
  }
}

const decodeV4ExactOutSingle = (params: string): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(
      [
        `tuple(${POOL_KEY_TYPE} poolKey, bool zeroForOne, uint128 amountOut, uint128 amountInMaximum, bytes hookData)`,
      ],
      params
    )
  )
  if (!decoded) return null
  const [{ poolKey, zeroForOne, amountOut, amountInMaximum }] =
    decoded as unknown as [
      {
        poolKey: { currency0: string; currency1: string }
        zeroForOne: boolean
        amountOut: bigint
        amountInMaximum: bigint
      },
    ]
  const fromToken = normalize(zeroForOne ? poolKey.currency0 : poolKey.currency1)
  const toToken = normalize(zeroForOne ? poolKey.currency1 : poolKey.currency0)
  return {
    fromToken,
    toToken,
    amountIn: amountInMaximum,
    amountOutMin: amountOut,
    isExactOut: true,
  }
}

const decodeV4ExactOut = (params: string): SwapEntry | null => {
  const decoded = safeDecode(() =>
    coder.decode(
      [
        `tuple(address currencyOut, ${PATH_KEY_TYPE}[] path, uint128 amountOut, uint128 amountInMaximum)`,
      ],
      params
    )
  )
  if (!decoded) return null
  const [{ currencyOut, path, amountOut, amountInMaximum }] =
    decoded as unknown as [
      {
        currencyOut: string
        path: { intermediateCurrency: string }[]
        amountOut: bigint
        amountInMaximum: bigint
      },
    ]
  if (!Array.isArray(path) || path.length === 0) return null
  // For exact-out, the first PathKey's intermediateCurrency is the token the
  // user spends; the path walks forward to currencyOut.
  return {
    fromToken: normalize(path[0].intermediateCurrency),
    toToken: normalize(currencyOut),
    amountIn: amountInMaximum,
    amountOutMin: amountOut,
    isExactOut: true,
  }
}

const decodeV4SwapInput = (input: string): SwapEntry | null => {
  const outer = safeDecode(() =>
    coder.decode(['bytes', 'bytes[]'], input)
  )
  if (!outer) return null
  const [actions, params] = outer as unknown as [string, string[]]
  const actionBytes = getBytes(actions)
  if (actionBytes.length !== params.length) return null

  // Walk actions in order; first swap action wins since V4 swaps only emit
  // one per command in practice. Take-All/Settle-All surround it but don't
  // change the aggregate intent.
  for (let i = 0; i < actionBytes.length; i++) {
    const action = actionBytes[i]
    const payload = params[i]
    if (action === V4Action.SWAP_EXACT_IN_SINGLE) {
      const entry = decodeV4ExactInSingle(payload)
      if (entry) return entry
    } else if (action === V4Action.SWAP_EXACT_IN) {
      const entry = decodeV4ExactIn(payload)
      if (entry) return entry
    } else if (action === V4Action.SWAP_EXACT_OUT_SINGLE) {
      const entry = decodeV4ExactOutSingle(payload)
      if (entry) return entry
    } else if (action === V4Action.SWAP_EXACT_OUT) {
      const entry = decodeV4ExactOut(payload)
      if (entry) return entry
    }
  }
  return null
}

const decodeWrapEth = (input: string): bigint | null => {
  const decoded = safeDecode(() =>
    coder.decode(['address', 'uint256'], input)
  )
  if (!decoded) return null
  const [, amount] = decoded as unknown as [string, bigint]
  return amount
}

/**
 * Decode Uniswap Universal Router `execute(...)` calldata into an aggregate
 * swap intent (from token, to token, amount in, amount out minimum).
 *
 * Returns `null` for calldata that is not a Universal Router execute call or
 * that contains no recognizable swap opcode. Unknown opcodes inside an
 * otherwise valid execute call are skipped rather than rejected — the router
 * frequently bundles Permit2/sweep/transfer commands around swaps.
 */
export const decodeUniversalRouterExecute = (
  calldata: string
): UniversalRouterSwapIntent | null => {
  if (!calldata || !calldata.startsWith('0x') || calldata.length < 10) {
    return null
  }

  const parsed = safeDecode(() =>
    urInterface.parseTransaction({ data: calldata })
  )
  if (!parsed || parsed.name !== 'execute') return null

  const commandsHex = parsed.args[0] as string
  const inputs = parsed.args[1] as string[]
  const commands = getBytes(commandsHex)
  if (commands.length !== inputs.length) return null

  const swaps: SwapEntry[] = []
  let wrapEthAmount: bigint | null = null
  let sawUnwrapWeth = false
  let sawKnownCommand = false

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i] & COMMAND_TYPE_MASK
    const input = inputs[i]
    if (command === URCommand.V2_SWAP_EXACT_IN) {
      sawKnownCommand = true
      const entry = decodeV2Swap(input, false)
      if (entry) swaps.push(entry)
    } else if (command === URCommand.V2_SWAP_EXACT_OUT) {
      sawKnownCommand = true
      const entry = decodeV2Swap(input, true)
      if (entry) swaps.push(entry)
    } else if (command === URCommand.V3_SWAP_EXACT_IN) {
      sawKnownCommand = true
      const entry = decodeV3Swap(input, false)
      if (entry) swaps.push(entry)
    } else if (command === URCommand.V3_SWAP_EXACT_OUT) {
      sawKnownCommand = true
      const entry = decodeV3Swap(input, true)
      if (entry) swaps.push(entry)
    } else if (command === URCommand.WRAP_ETH) {
      sawKnownCommand = true
      // Only the wrap that precedes the first swap matters for the user's
      // input side; later wraps are intermediate routing.
      if (swaps.length === 0) {
        wrapEthAmount = decodeWrapEth(input)
      }
    } else if (command === URCommand.UNWRAP_WETH) {
      sawKnownCommand = true
      sawUnwrapWeth = true
    } else if (command === URCommand.V4_SWAP) {
      sawKnownCommand = true
      const entry = decodeV4SwapInput(input)
      if (entry) swaps.push(entry)
    }
  }

  if (!sawKnownCommand || swaps.length === 0) return null

  const first = swaps[0]
  const last = swaps[swaps.length - 1]

  // Uniswap's routing splits a single pair across several pool legs when that
  // gives better execution. Each leg is its own swap command but they all
  // share the same (fromToken, toToken). We detect that and sum amounts so
  // the user sees their full trade — not just one leg's share.
  const isSplitRoute =
    swaps.length > 1 &&
    swaps.every(
      s => s.fromToken === first.fromToken && s.toToken === first.toToken
    )

  let fromToken = first.fromToken
  let toToken = isSplitRoute ? first.toToken : last.toToken
  let amountIn = isSplitRoute
    ? swaps.reduce((sum, s) => sum + s.amountIn, 0n)
    : first.amountIn
  const aggregatedAmountOutMin = isSplitRoute
    ? swaps.reduce((sum, s) => sum + s.amountOutMin, 0n)
    : last.amountOutMin

  if (wrapEthAmount !== null) {
    fromToken = NATIVE_TOKEN_ADDRESS
    // WRAP_ETH's amount is the user's total native input for the whole
    // sequence. The first swap leg's amountIn/amountInMax only covers that
    // leg (wrong when the swap is multi-hop or exact-out), so prefer the
    // wrap amount whenever it isn't a "use router balance" sentinel.
    if (wrapEthAmount !== CONTRACT_BALANCE_SENTINEL) {
      amountIn = wrapEthAmount
    } else if (amountIn === CONTRACT_BALANCE_SENTINEL) {
      amountIn = wrapEthAmount
    }
  }

  if (sawUnwrapWeth) {
    // UR emits UNWRAP_WETH for two different reasons and they have opposite
    // meanings for the user-facing output token:
    //   1. Output conversion: the final swap lands in WETH and UNWRAP_WETH
    //      converts it to native. The swap is effectively ERC20 → NATIVE.
    //   2. Leftover refund: an exact-out flow wrapped too much ETH upfront
    //      and UNWRAP_WETH refunds the unused remainder as native. The swap
    //      output is still the last leg's ERC20 toToken.
    // We distinguish them: a leftover refund only happens AFTER a WRAP_ETH,
    // and only when the last swap's toToken is something OTHER than the
    // wrapped-native token that was the router's working asset (= first
    // swap's fromToken). If the last swap's toToken matches the wrapped
    // native, it's an output conversion back to native.
    const isLeftoverRefund =
      wrapEthAmount !== null && last.toToken !== first.fromToken
    if (!isLeftoverRefund) {
      toToken = NATIVE_TOKEN_ADDRESS
    }
  }

  return {
    fromToken,
    toToken,
    amountIn,
    amountOutMin: aggregatedAmountOutMin,
    isExactOut: last.isExactOut,
  }
}
