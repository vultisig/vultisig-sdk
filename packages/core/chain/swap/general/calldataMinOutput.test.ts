import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'

import { assertAggregatorCalldataMinOutputBound, decodeAggregatorCalldataMinOutput } from './calldataMinOutput'

const ADDRESS = '0x0000000000000000000000000000000000000001'
const OTHER_ADDRESS = '0x0000000000000000000000000000000000000002'
const BYTES32 = `0x${'11'.repeat(32)}` as const

const oneInchSwapAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
])

const kyberSwapAbi = parseAbi([
  'function swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
])

const lifiSwapAbi = parseAbi([
  'function swapTokensSingleV3NativeToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData) payable',
])

const oneInchCalldata = (minReturnAmount: bigint) =>
  encodeFunctionData({
    abi: oneInchSwapAbi,
    functionName: 'swap',
    args: [
      ADDRESS,
      {
        srcToken: ADDRESS,
        dstToken: OTHER_ADDRESS,
        srcReceiver: ADDRESS,
        dstReceiver: ADDRESS,
        amount: 1_000_000n,
        minReturnAmount,
        flags: 0n,
      },
      '0x',
    ],
  })

const kyberCalldata = (minReturnAmount: bigint) =>
  encodeFunctionData({
    abi: kyberSwapAbi,
    functionName: 'swap',
    args: [
      {
        callTarget: ADDRESS,
        approveTarget: ADDRESS,
        targetData: '0x',
        desc: {
          srcToken: ADDRESS,
          dstToken: OTHER_ADDRESS,
          srcReceivers: [ADDRESS],
          srcAmounts: [1_000_000n],
          feeReceivers: [],
          feeAmounts: [],
          dstReceiver: ADDRESS,
          amount: 1_000_000n,
          minReturnAmount,
          flags: 0n,
          permit: '0x',
        },
        clientData: '0x',
      },
    ],
  })

const lifiCalldata = (minAmountOut: bigint) =>
  encodeFunctionData({
    abi: lifiSwapAbi,
    functionName: 'swapTokensSingleV3NativeToERC20',
    args: [
      BYTES32,
      'vultisig-0',
      '0x0000000000000000000000000000000000000000',
      ADDRESS,
      minAmountOut,
      {
        callTo: OTHER_ADDRESS,
        approveTo: OTHER_ADDRESS,
        sendingAssetId: ADDRESS,
        receivingAssetId: OTHER_ADDRESS,
        fromAmount: 1_000_000n,
        callData: '0x12345678',
        requiresDeposit: false,
      },
    ],
  })

describe('decodeAggregatorCalldataMinOutput', () => {
  it('decodes 1inch V6 swap minReturnAmount', () => {
    expect(decodeAggregatorCalldataMinOutput({ provider: '1inch', data: oneInchCalldata(995_000n) })).toBe(995_000n)
  })

  it('decodes Kyber MetaAggregationRouterV2 minReturnAmount', () => {
    expect(decodeAggregatorCalldataMinOutput({ provider: 'kyber', data: kyberCalldata(990_000n) })).toBe(990_000n)
  })

  it('decodes LI.FI GenericSwapFacetV3 minAmountOut', () => {
    expect(decodeAggregatorCalldataMinOutput({ provider: 'li.fi', data: lifiCalldata(997_000n) })).toBe(997_000n)
  })

  it('rejects a LI.FI cross-chain facet selector whose source deposit is not a comparable final-output floor', () => {
    expect(() =>
      decodeAggregatorCalldataMinOutput({
        provider: 'li.fi',
        data: `0xa3443faa${'00'.repeat(32)}`,
      })
    ).toThrow(/does not expose a sign-time-verifiable final minimum output/)
  })

  it('rejects malformed calldata', () => {
    expect(() => decodeAggregatorCalldataMinOutput({ provider: '1inch', data: '0xdeadbeef0' })).toThrow(
      /malformed EVM swap calldata/
    )
  })
})

describe('assertAggregatorCalldataMinOutputBound', () => {
  it('accepts a router floor that exactly matches the requested slippage bound', () => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data: oneInchCalldata(995_000n),
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).not.toThrow()
  })

  it('rejects the reported attack scenario where displayed output is high but calldata accepts one wei', () => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'kyber',
        data: kyberCalldata(1n),
        quotedOutputAmount: '1000000000',
        maxSlippageBps: 100,
      })
    ).toThrow(/minimum output \(1\) is below the quote-bound floor \(990000000\)/)
  })

  it('fails closed when a protected provider has no sign-time slippage policy', () => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'li.fi',
        data: lifiCalldata(990_000n),
        quotedOutputAmount: '1000000',
        maxSlippageBps: undefined,
      })
    ).toThrow(/no valid slippage policy/)
  })

  it('does not apply the opaque-calldata guard to providers with a different signed-floor contract', () => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'cowswap',
        data: 'cowswap-order:opaque',
        quotedOutputAmount: '1',
        maxSlippageBps: undefined,
      })
    ).not.toThrow()
  })
})
