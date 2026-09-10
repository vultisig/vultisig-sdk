import { encodeFunctionData, parseAbi, zeroAddress } from 'viem'
import { describe, expect, it } from 'vitest'

import { decodeEvmGeneralSwapCommitment } from '@/tools/prep/decodeEvmGeneralSwapCommitment'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const ROUTER = '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
const RECIPIENT = '0x1111111111111111111111111111111111111111'
const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 600)
const PAST = BigInt(1_700_000_000)

const v2Abi = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)',
  'function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] path, address to, uint256 deadline)',
])

const v3Abi = parseAbi([
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params)',
])

const oneInchAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
])

const thorAbi = parseAbi([
  'function depositWithExpiry(address vault, address asset, uint256 amount, string memo, uint256 expiry)',
])

describe('decodeEvmGeneralSwapCommitment', () => {
  it('returns null for opaque aggregator calldata', () => {
    expect(decodeEvmGeneralSwapCommitment('0xdeadbeef', '0')).toBeNull()
    expect(decodeEvmGeneralSwapCommitment('0x', '0')).toBeNull()
    expect(decodeEvmGeneralSwapCommitment('', '0')).toBeNull()
  })

  it('treats a native-only value (no calldata) as the sell amount', () => {
    expect(decodeEvmGeneralSwapCommitment('0x', '1000000000000000000')).toEqual({
      sellAmount: 10n ** 18n,
    })
  })

  it('decodes Uniswap V2 swapExactTokensForTokens amountIn + deadline', () => {
    const data = encodeFunctionData({
      abi: v2Abi,
      functionName: 'swapExactTokensForTokens',
      args: [1_000_000n, 990_000n, [USDC, WETH], RECIPIENT, FUTURE],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toEqual({
      sellAmount: 1_000_000n,
      deadlineSeconds: Number(FUTURE),
    })
  })

  it('decodes Uniswap V2 swapExactETHForTokens from tx.value + deadline', () => {
    const data = encodeFunctionData({
      abi: v2Abi,
      functionName: 'swapExactETHForTokens',
      args: [1n, [WETH, USDC], RECIPIENT, FUTURE],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '500000000000000000')).toEqual({
      sellAmount: 5n * 10n ** 17n,
      deadlineSeconds: Number(FUTURE),
    })
  })

  it('returns null for swapExactETHForTokens when value is zero (no sell to bind)', () => {
    const data = encodeFunctionData({
      abi: v2Abi,
      functionName: 'swapExactETHForTokens',
      args: [1n, [WETH, USDC], RECIPIENT, FUTURE],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toBeNull()
  })

  it('does not treat exact-out amountInMax as a committed sell', () => {
    const data = encodeFunctionData({
      abi: v2Abi,
      functionName: 'swapTokensForExactTokens',
      args: [1_000_000n, 2_000_000n, [USDC, WETH], RECIPIENT, FUTURE],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toBeNull()
  })

  it('decodes Uniswap V3 exactInputSingle amountIn + deadline', () => {
    const data = encodeFunctionData({
      abi: v3Abi,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: USDC,
          tokenOut: WETH,
          fee: 3000,
          recipient: RECIPIENT,
          deadline: FUTURE,
          amountIn: 42_000_000n,
          amountOutMinimum: 1n,
          sqrtPriceLimitX96: 0n,
        },
      ],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toEqual({
      sellAmount: 42_000_000n,
      deadlineSeconds: Number(FUTURE),
    })
  })

  it('decodes 1inch V5 swap description.amount', () => {
    const data = encodeFunctionData({
      abi: oneInchAbi,
      functionName: 'swap',
      args: [
        ROUTER,
        {
          srcToken: USDC,
          dstToken: WETH,
          srcReceiver: ROUTER,
          dstReceiver: RECIPIENT,
          amount: 8_000_000n,
          minReturnAmount: 1n,
          flags: 0n,
        },
        '0x',
        '0x',
      ],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toEqual({
      sellAmount: 8_000_000n,
    })
  })

  it('decodes THOR depositWithExpiry amount + expiry', () => {
    const data = encodeFunctionData({
      abi: thorAbi,
      functionName: 'depositWithExpiry',
      args: [ROUTER, zeroAddress, 3n * 10n ** 18n, '=:ETH.ETH', PAST],
    })
    expect(decodeEvmGeneralSwapCommitment(data, '0')).toEqual({
      sellAmount: 3n * 10n ** 18n,
      deadlineSeconds: Number(PAST),
    })
  })
})
