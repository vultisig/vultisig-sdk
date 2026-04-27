import { AbiCoder, Interface } from 'ethers'
import { describe, expect, it } from 'vitest'

import { decodeUniversalRouterExecute } from './decode'
import {
  CONTRACT_BALANCE_SENTINEL,
  NATIVE_TOKEN_ADDRESS,
  URCommand,
  V4Action,
} from './opcodes'

const coder = AbiCoder.defaultAbiCoder()
const urInterface = new Interface([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline)',
])

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const DAI = '0x6B175474E89094C44Da98b954EedeAC495271d0F'
const RECIPIENT = '0x1111111111111111111111111111111111111111'

const commandsFor = (...opcodes: number[]): string =>
  '0x' + opcodes.map(op => op.toString(16).padStart(2, '0')).join('')

const encodeV2Input = (args: {
  recipient: string
  amountIn: bigint
  amountOutMin: bigint
  path: string[]
  payerIsUser: boolean
}) =>
  coder.encode(
    ['address', 'uint256', 'uint256', 'address[]', 'bool'],
    [args.recipient, args.amountIn, args.amountOutMin, args.path, args.payerIsUser]
  )

const encodeV3Input = (args: {
  recipient: string
  amountIn: bigint
  amountOutMin: bigint
  path: string
  payerIsUser: boolean
}) =>
  coder.encode(
    ['address', 'uint256', 'uint256', 'bytes', 'bool'],
    [args.recipient, args.amountIn, args.amountOutMin, args.path, args.payerIsUser]
  )

const encodeV3Path = (tokens: string[], fees: number[]): string => {
  if (tokens.length !== fees.length + 1) {
    throw new Error('fees must have length tokens.length - 1')
  }
  const parts: string[] = []
  for (let i = 0; i < fees.length; i++) {
    parts.push(tokens[i].toLowerCase().replace(/^0x/, ''))
    parts.push(fees[i].toString(16).padStart(6, '0'))
  }
  parts.push(tokens[tokens.length - 1].toLowerCase().replace(/^0x/, ''))
  return '0x' + parts.join('')
}

const encodeWrapEthInput = (amount: bigint) =>
  coder.encode(['address', 'uint256'], [RECIPIENT, amount])

const buildExecuteCalldata = (
  commands: string,
  inputs: string[],
  deadline = 0n
): string =>
  urInterface.encodeFunctionData('execute', [commands, inputs, deadline])

describe('decodeUniversalRouterExecute', () => {
  it('returns null for non-UR calldata', () => {
    const transferIface = new Interface([
      'function transfer(address,uint256)',
    ])
    const calldata = transferIface.encodeFunctionData('transfer', [
      RECIPIENT,
      1n,
    ])
    expect(decodeUniversalRouterExecute(calldata)).toBeNull()
  })

  it('returns null for malformed calldata', () => {
    expect(decodeUniversalRouterExecute('0x')).toBeNull()
    expect(decodeUniversalRouterExecute('')).toBeNull()
    expect(decodeUniversalRouterExecute('0xdeadbeef')).toBeNull()
  })

  it('decodes a V2 exact-in swap (USDC → DAI)', () => {
    const input = encodeV2Input({
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMin: 990_000_000_000_000_000n,
      path: [USDC, DAI],
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V2_SWAP_EXACT_IN),
      [input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: USDC.toLowerCase(),
      toToken: DAI.toLowerCase(),
      amountIn: 1_000_000n,
      amountOutMin: 990_000_000_000_000_000n,
      isExactOut: false,
    })
  })

  it('decodes a V2 exact-out swap (reports amountInMax as amountIn)', () => {
    const input = encodeV2Input({
      recipient: RECIPIENT,
      amountIn: 5n * 10n ** 18n, // amountOut for exact-out
      amountOutMin: 2_000_000n, // amountInMax for exact-out
      path: [USDC, DAI],
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V2_SWAP_EXACT_OUT),
      [input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: USDC.toLowerCase(),
      toToken: DAI.toLowerCase(),
      amountIn: 2_000_000n,
      amountOutMin: 5n * 10n ** 18n,
      isExactOut: true,
    })
  })

  it('decodes a V3 exact-in multi-hop swap (USDC → WETH → DAI)', () => {
    const path = encodeV3Path([USDC, WETH, DAI], [500, 3000])
    const input = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 2_000_000n,
      amountOutMin: 1_900_000_000_000_000_000n,
      path,
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V3_SWAP_EXACT_IN),
      [input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: USDC.toLowerCase(),
      toToken: DAI.toLowerCase(),
      amountIn: 2_000_000n,
      amountOutMin: 1_900_000_000_000_000_000n,
      isExactOut: false,
    })
  })

  it('decodes a V3 exact-out swap (path is reversed in v3 exact-out)', () => {
    // For V3 exact-out the path is tokenOut → tokenIn in the calldata; the
    // decoder should flip this for the user-facing intent.
    const reversedPath = encodeV3Path([DAI, USDC], [500])
    const input = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 1_000_000_000_000_000_000n, // amountOut for exact-out
      amountOutMin: 2_000_000n, // amountInMax for exact-out
      path: reversedPath,
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V3_SWAP_EXACT_OUT),
      [input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: USDC.toLowerCase(),
      toToken: DAI.toLowerCase(),
      amountIn: 2_000_000n,
      amountOutMin: 1_000_000_000_000_000_000n,
      isExactOut: true,
    })
  })

  it('maps WRAP_ETH + V3 swap to native ETH as input', () => {
    const wrapInput = encodeWrapEthInput(10n ** 18n)
    const swapInput = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 10n ** 18n,
      amountOutMin: 2_000_000_000n,
      path: encodeV3Path([WETH, USDC], [500]),
      payerIsUser: false,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.WRAP_ETH, URCommand.V3_SWAP_EXACT_IN),
      [wrapInput, swapInput]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(NATIVE_TOKEN_ADDRESS)
    expect(intent?.toToken).toBe(USDC.toLowerCase())
    expect(intent?.amountIn).toBe(10n ** 18n)
  })

  it('substitutes WRAP_ETH amount when swap uses CONTRACT_BALANCE sentinel', () => {
    const wrapInput = encodeWrapEthInput(5n * 10n ** 18n)
    const swapInput = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: CONTRACT_BALANCE_SENTINEL,
      amountOutMin: 1n,
      path: encodeV3Path([WETH, USDC], [500]),
      payerIsUser: false,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.WRAP_ETH, URCommand.V3_SWAP_EXACT_IN),
      [wrapInput, swapInput]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.amountIn).toBe(5n * 10n ** 18n)
  })

  it('ignores UNWRAP_WETH leftover refund after WRAP_ETH + exact-out swap', () => {
    // Real-world shape: user swaps native ETH → USDC exact-out. UR wraps the
    // max input, runs V3_EXACT_OUT (path reversed: USDC → WETH in calldata),
    // then UNWRAP_WETH refunds the unused WETH. Output is USDC, not native.
    const wrapInput = encodeWrapEthInput(2n * 10n ** 18n) // max 2 ETH
    const swapInput = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 5_000_000n, // amountOut = 5 USDC
      amountOutMin: 2n * 10n ** 18n, // amountInMax = 2 WETH
      path: encodeV3Path([USDC, WETH], [500]), // exact-out path is reversed
      payerIsUser: false,
    })
    const unwrapInput = coder.encode(
      ['address', 'uint256'],
      [RECIPIENT, 0n] // refund whatever's left
    )
    const calldata = buildExecuteCalldata(
      commandsFor(
        URCommand.WRAP_ETH,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.UNWRAP_WETH
      ),
      [wrapInput, swapInput, unwrapInput]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(NATIVE_TOKEN_ADDRESS)
    expect(intent?.toToken).toBe(USDC.toLowerCase())
    // WRAP_ETH amount (2 ETH) wins over the first-leg amountInMax.
    expect(intent?.amountIn).toBe(2n * 10n ** 18n)
    expect(intent?.amountOutMin).toBe(5_000_000n)
    expect(intent?.isExactOut).toBe(true)
  })

  it('prefers WRAP_ETH amount over first-leg amountInMax for multi-hop exact-out', () => {
    // Multi-hop exact-out: WRAP_ETH is the total user input; each V3 leg has
    // its own amountInMax for that leg only. Aggregating the first leg's
    // amountInMax would under-report the user's real spend.
    const wrapAmount = 5n * 10n ** 18n // user sends 5 ETH total
    const wrapInput = encodeWrapEthInput(wrapAmount)
    const leg1 = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 1_000_000n,
      amountOutMin: 3n * 10n ** 18n, // leg-1 amountInMax: 3 WETH
      path: encodeV3Path([USDC, WETH], [500]),
      payerIsUser: false,
    })
    const leg2 = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 2_000_000n,
      amountOutMin: 2n * 10n ** 18n, // leg-2 amountInMax: 2 WETH
      path: encodeV3Path([DAI, WETH], [3000]),
      payerIsUser: false,
    })
    const unwrapInput = coder.encode(['address', 'uint256'], [RECIPIENT, 0n])
    const calldata = buildExecuteCalldata(
      commandsFor(
        URCommand.WRAP_ETH,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.UNWRAP_WETH
      ),
      [wrapInput, leg1, leg2, unwrapInput]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(NATIVE_TOKEN_ADDRESS)
    // Last leg's toToken is DAI (path reversed: DAI ← WETH), so the final
    // aggregate output is DAI, not the WETH that UNWRAP_WETH refunds.
    expect(intent?.toToken).toBe(DAI.toLowerCase())
    expect(intent?.amountIn).toBe(wrapAmount)
  })

  it('maps V3 swap + UNWRAP_WETH to native ETH as output', () => {
    const swapInput = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 2_000_000n,
      amountOutMin: 10n ** 17n,
      path: encodeV3Path([USDC, WETH], [500]),
      payerIsUser: true,
    })
    const unwrapInput = coder.encode(
      ['address', 'uint256'],
      [RECIPIENT, 10n ** 17n]
    )
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V3_SWAP_EXACT_IN, URCommand.UNWRAP_WETH),
      [swapInput, unwrapInput]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(USDC.toLowerCase())
    expect(intent?.toToken).toBe(NATIVE_TOKEN_ADDRESS)
  })

  it('ignores the allow-revert flag bit on command bytes', () => {
    const withRevertFlag = 0x80 | URCommand.V2_SWAP_EXACT_IN
    const input = encodeV2Input({
      recipient: RECIPIENT,
      amountIn: 100n,
      amountOutMin: 90n,
      path: [USDC, DAI],
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(commandsFor(withRevertFlag), [input])
    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(USDC.toLowerCase())
    expect(intent?.toToken).toBe(DAI.toLowerCase())
  })

  it('decodes a V4 single-pool swap', () => {
    const poolKey = {
      currency0: DAI,
      currency1: USDC,
      fee: 500,
      tickSpacing: 10,
      hooks: '0x0000000000000000000000000000000000000000',
    }
    const exactInSingleParams = coder.encode(
      [
        'tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, bytes hookData)',
      ],
      [
        {
          poolKey,
          zeroForOne: true, // spending currency0 = DAI
          amountIn: 10n ** 18n,
          amountOutMinimum: 900_000n,
          hookData: '0x',
        },
      ]
    )
    const actions = '0x' + V4Action.SWAP_EXACT_IN_SINGLE.toString(16).padStart(2, '0')
    const v4Input = coder.encode(
      ['bytes', 'bytes[]'],
      [actions, [exactInSingleParams]]
    )
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V4_SWAP),
      [v4Input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: DAI.toLowerCase(),
      toToken: USDC.toLowerCase(),
      amountIn: 10n ** 18n,
      amountOutMin: 900_000n,
      isExactOut: false,
    })
  })

  it('decodes a V4 exact-out single-pool swap (zeroForOne=false)', () => {
    const poolKey = {
      currency0: DAI,
      currency1: USDC,
      fee: 500,
      tickSpacing: 10,
      hooks: '0x0000000000000000000000000000000000000000',
    }
    const params = coder.encode(
      [
        'tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 amountOut, uint128 amountInMaximum, bytes hookData)',
      ],
      [
        {
          poolKey,
          zeroForOne: false, // spending currency1 = USDC
          amountOut: 10n ** 18n,
          amountInMaximum: 1_100_000n,
          hookData: '0x',
        },
      ]
    )
    const actions = '0x' + V4Action.SWAP_EXACT_OUT_SINGLE.toString(16).padStart(2, '0')
    const v4Input = coder.encode(['bytes', 'bytes[]'], [actions, [params]])
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V4_SWAP),
      [v4Input]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent).toEqual({
      fromToken: USDC.toLowerCase(),
      toToken: DAI.toLowerCase(),
      amountIn: 1_100_000n,
      amountOutMin: 10n ** 18n,
      isExactOut: true,
    })
  })

  it('sums amountIn and amountOutMin across split V3 exact-in legs', () => {
    // Uniswap splits a single pair trade across several pools. Each leg is
    // its own swap command but they share fromToken/toToken. Reporting only
    // the first leg's amounts would dramatically under-count the trade.
    const legA = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 600_000n,
      amountOutMin: 590_000_000_000_000_000n,
      path: encodeV3Path([USDC, DAI], [500]),
      payerIsUser: true,
    })
    const legB = encodeV3Input({
      recipient: RECIPIENT,
      amountIn: 400_000n,
      amountOutMin: 395_000_000_000_000_000n,
      path: encodeV3Path([USDC, DAI], [3000]),
      payerIsUser: true,
    })
    const calldata = buildExecuteCalldata(
      commandsFor(URCommand.V3_SWAP_EXACT_IN, URCommand.V3_SWAP_EXACT_IN),
      [legA, legB]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(USDC.toLowerCase())
    expect(intent?.toToken).toBe(DAI.toLowerCase())
    expect(intent?.amountIn).toBe(1_000_000n)
    expect(intent?.amountOutMin).toBe(985_000_000_000_000_000n)
  })

  it('sums split V3 exact-out legs under WRAP_ETH + UNWRAP_WETH refund', () => {
    // Mirrors the real BNB → BUSD case: WRAP_ETH for the full input, three
    // V3_EXACT_OUT legs splitting the buy across pools, then UNWRAP_WETH to
    // refund any leftover wrapped balance. The aggregate intent is native →
    // ERC20 with the full target amount summed across legs.
    const wrapAmount = 2_150_000_000_000_000n
    const wrapInput = encodeWrapEthInput(wrapAmount)
    const mkLeg = (amountOut: bigint, amountInMax: bigint) =>
      encodeV3Input({
        recipient: RECIPIENT,
        amountIn: amountOut,
        amountOutMin: amountInMax,
        path: encodeV3Path([USDC, WETH], [500]),
        payerIsUser: false,
      })
    const unwrapInput = coder.encode(['address', 'uint256'], [RECIPIENT, 0n])
    const calldata = buildExecuteCalldata(
      commandsFor(
        URCommand.WRAP_ETH,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.V3_SWAP_EXACT_OUT,
        URCommand.UNWRAP_WETH
      ),
      [
        wrapInput,
        mkLeg(500_000n, 800_000_000_000_000n),
        mkLeg(400_000n, 700_000_000_000_000n),
        mkLeg(300_000n, 600_000_000_000_000n),
        unwrapInput,
      ]
    )

    const intent = decodeUniversalRouterExecute(calldata)
    expect(intent?.fromToken).toBe(NATIVE_TOKEN_ADDRESS)
    expect(intent?.toToken).toBe(USDC.toLowerCase())
    // WRAP_ETH wins for amountIn (full authorized input).
    expect(intent?.amountIn).toBe(wrapAmount)
    // amountOutMin is the sum of the three legs' amountOut values.
    expect(intent?.amountOutMin).toBe(1_200_000n)
    expect(intent?.isExactOut).toBe(true)
  })

  it('returns null when execute carries only unsupported commands', () => {
    // 0x02 = PERMIT2_TRANSFER_FROM — we don't decode it and there's no swap.
    const permitInput = coder.encode(
      ['address', 'address', 'uint160'],
      [USDC, RECIPIENT, 1n]
    )
    const calldata = buildExecuteCalldata('0x02', [permitInput])
    expect(decodeUniversalRouterExecute(calldata)).toBeNull()
  })
})
