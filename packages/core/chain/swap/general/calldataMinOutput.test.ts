import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'

import {
  assertAggregatorCalldataMinOutputBound as assertBound,
  decodeAggregatorCalldataMinOutput,
  toMaxSlippageBps,
} from './calldataMinOutput'

const ADDRESS = '0x0000000000000000000000000000000000000001' as const
const OTHER_ADDRESS = '0x0000000000000000000000000000000000000002' as const
const BYTES32 = `0x${'11'.repeat(32)}` as const
const assertAggregatorCalldataMinOutputBound = (input: Parameters<typeof assertBound>[0]) =>
  assertBound({
    destinationAsset: OTHER_ADDRESS,
    intendedRecipient: ADDRESS,
    senderAddress: ADDRESS,
    ...input,
  })

const oneInchSwapAbi = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
])

const kyberSwapAbi = parseAbi([
  'function swap((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
])

const lifiSwapAbi = parseAbi([
  'function swapTokensSingleV3NativeToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData) payable',
])

const oneInchCalldata = (minReturnAmount: bigint, dstReceiver: `0x${string}` = ADDRESS, flags = 0n) =>
  encodeFunctionData({
    abi: oneInchSwapAbi,
    functionName: 'swap',
    args: [
      ADDRESS,
      {
        srcToken: ADDRESS,
        dstToken: OTHER_ADDRESS,
        srcReceiver: ADDRESS,
        dstReceiver,
        amount: 1_000_000n,
        minReturnAmount,
        flags,
      },
      '0x',
    ],
  })

const kyberCalldata = (minReturnAmount: bigint, dstReceiver: `0x${string}` = ADDRESS, flags = 0n) =>
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
          dstReceiver,
          amount: 1_000_000n,
          minReturnAmount,
          flags,
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
    expect(
      decodeAggregatorCalldataMinOutput({
        provider: '1inch',
        data: oneInchCalldata(995_000n),
      })
    ).toBe(995_000n)
  })

  it('binds 1inch zero dstReceiver to the transaction sender', () => {
    const data = oneInchCalldata(995_000n, '0x0000000000000000000000000000000000000000')
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).not.toThrow()
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
        intendedRecipient: OTHER_ADDRESS,
      })
    ).toThrow(/output receiver/)
  })

  it('decodes Kyber MetaAggregationRouterV2 minReturnAmount', () => {
    expect(
      decodeAggregatorCalldataMinOutput({
        provider: 'kyber',
        data: kyberCalldata(990_000n),
      })
    ).toBe(990_000n)
  })

  it('binds Kyber zero dstReceiver to the transaction sender', () => {
    const data = kyberCalldata(995_000n, '0x0000000000000000000000000000000000000000')
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'kyber',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).not.toThrow()
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'kyber',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
        intendedRecipient: OTHER_ADDRESS,
      })
    ).toThrow(/output receiver/)
  })

  it('decodes LI.FI GenericSwapFacetV3 minAmountOut', () => {
    expect(
      decodeAggregatorCalldataMinOutput({
        provider: 'li.fi',
        data: lifiCalldata(997_000n),
      })
    ).toBe(997_000n)
  })

  it('leaves LI.FI cross-chain calldata explicitly unverifiable', () => {
    expect(
      decodeAggregatorCalldataMinOutput({
        provider: 'li.fi',
        data: `0xa3443faa${'00'.repeat(32)}`,
      })
    ).toBeUndefined()
  })

  it('rejects malformed calldata', () => {
    expect(() =>
      decodeAggregatorCalldataMinOutput({
        provider: '1inch',
        data: '0xdeadbeef0',
      })
    ).toThrow(/malformed EVM swap calldata/)
  })
})

describe('assertAggregatorCalldataMinOutputBound', () => {
  it.each(['1inch', 'kyber'] as const)('rejects %s proportional partial fills as an absolute floor', provider => {
    const data = provider === '1inch' ? oneInchCalldata(995_000n, ADDRESS, 1n) : kyberCalldata(995_000n, ADDRESS, 1n)
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider,
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).toThrow(/partial-fill calldata has no absolute minimum output/)
  })

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

const oneInchVariants = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data) payable returns (uint256 returnAmount, uint256 spentAmount)',
  'function unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)',
  'function unoswapTo(uint256 recipient, uint256 token, uint256 amount, uint256 minReturn, uint256 dex) returns (uint256 returnAmount)',
  'function ethUnoswap(uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)',
  'function ethUnoswapTo(uint256 recipient, uint256 minReturn, uint256 dex) payable returns (uint256 returnAmount)',
  'function uniswapV3Swap(uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function clipperSwap(address clipperExchange, uint256 srcToken, address dstToken, uint256 inputAmount, uint256 outputAmount, uint256 goodUntil, bytes32 r, bytes32 vs) payable returns (uint256 returnAmount)',
  'function unoswapTo(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function unoswapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit) payable returns (uint256 returnAmount)',
  'function uniswapV3SwapTo(address recipient, uint256 amount, uint256 minReturn, uint256[] pools) payable returns (uint256 returnAmount)',
  'function uniswapV3SwapToWithPermit(address recipient, address srcToken, uint256 amount, uint256 minReturn, uint256[] pools, bytes permit) payable returns (uint256 returnAmount)',
])

const oneInchToRoutes = (recipient: typeof ADDRESS | typeof OTHER_ADDRESS) => [
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'unoswapTo',
    args: [BigInt(recipient), 1n, 1_000_000n, 995_000n, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'ethUnoswapTo',
    args: [BigInt(recipient), 995_000n, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'unoswapTo',
    args: [recipient, ADDRESS, 1_000_000n, 995_000n, [1n]],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'unoswapToWithPermit',
    args: [recipient, ADDRESS, 1_000_000n, 995_000n, [1n], '0x'],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'uniswapV3SwapTo',
    args: [recipient, 1_000_000n, 995_000n, [1n]],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'uniswapV3SwapToWithPermit',
    args: [recipient, ADDRESS, 1_000_000n, 995_000n, [1n], '0x'],
  }),
]

const swapDescription = (minReturnAmount: bigint) => ({
  srcToken: ADDRESS,
  dstToken: OTHER_ADDRESS,
  srcReceiver: ADDRESS,
  dstReceiver: ADDRESS,
  amount: 1_000_000n,
  minReturnAmount,
  flags: 0n,
})

const oneInchFamilyData = (min: bigint) => [
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'swap',
    args: [ADDRESS, swapDescription(min), '0x', '0x'],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'unoswap',
    args: [1n, 1_000_000n, min, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'unoswapTo',
    args: [1n, 1n, 1_000_000n, min, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'ethUnoswap',
    args: [min, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'ethUnoswapTo',
    args: [1n, min, 1n],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'uniswapV3Swap',
    args: [1_000_000n, min, [1n]],
  }),
  encodeFunctionData({
    abi: oneInchVariants,
    functionName: 'clipperSwap',
    args: [ADDRESS, 1n, OTHER_ADDRESS, 1_000_000n, min, 1n, BYTES32, BYTES32],
  }),
]

describe('known selector families and integer floor', () => {
  it('checks the low 160 beneficiary bits of a packed 1inch recipient', () => {
    const data = encodeFunctionData({
      abi: oneInchVariants,
      functionName: 'unoswapTo',
      args: [(1n << 200n) | BigInt(ADDRESS), 1n, 1_000_000n, 995_000n, 1n],
    })
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).not.toThrow()
  })

  it('binds implicit 1inch packed-pool recipients to the transaction sender', () => {
    const data = oneInchFamilyData(995_000n)[1]
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
        intendedRecipient: OTHER_ADDRESS,
      })
    ).toThrow(/output receiver/)
  })

  it.each(oneInchToRoutes(ADDRESS))('binds an exposed packed-pool 1inch recipient', data => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).not.toThrow()
  })

  it.each(oneInchToRoutes(OTHER_ADDRESS))('rejects a redirected packed-pool 1inch recipient', data => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
      })
    ).toThrow(/output receiver/)
  })

  it.each([oneInchFamilyData(995_000n)[0], oneInchFamilyData(995_000n)[6]])(
    'decodes and binds an explicit 1inch selector',
    data => {
      expect(decodeAggregatorCalldataMinOutput({ provider: '1inch', data })).toBe(995_000n)
      expect(() =>
        assertAggregatorCalldataMinOutputBound({
          provider: '1inch',
          data,
          quotedOutputAmount: '1000000',
          maxSlippageBps: 50,
        })
      ).not.toThrow()
    }
  )

  it.each(oneInchFamilyData(995_000n).slice(1, 6))(
    'leaves packed-pool 1inch routes available without a claimed asset binding',
    data => {
      expect(decodeAggregatorCalldataMinOutput({ provider: '1inch', data })).toBe(995_000n)
      expect(() =>
        assertAggregatorCalldataMinOutputBound({
          provider: '1inch',
          data,
          quotedOutputAmount: '1000000',
          maxSlippageBps: 50,
        })
      ).not.toThrow()
    }
  )

  it.each(oneInchFamilyData(1n).slice(1, 6))(
    'rejects a packed-pool one-wei minimum without claiming an asset binding',
    data => {
      expect(() =>
        assertAggregatorCalldataMinOutputBound({
          provider: '1inch',
          data,
          quotedOutputAmount: '1000000',
          maxSlippageBps: 50,
        })
      ).toThrow(/below the quote-bound floor/)
    }
  )

  it.each(['1inch', 'kyber', 'li.fi'] as const)('rejects a wrong destination asset for %s', provider => {
    const data =
      provider === '1inch'
        ? oneInchCalldata(995_000n)
        : provider === 'kyber'
          ? kyberCalldata(995_000n)
          : lifiCalldata(995_000n)
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider,
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
        destinationAsset: ADDRESS,
      })
    ).toThrow(/destination asset/)
  })

  it.each(['1inch', 'kyber', 'li.fi'] as const)('rejects a wrong output receiver for %s', provider => {
    const data =
      provider === '1inch'
        ? oneInchCalldata(995_000n)
        : provider === 'kyber'
          ? kyberCalldata(995_000n)
          : lifiCalldata(995_000n)
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider,
        data,
        quotedOutputAmount: '1000000',
        maxSlippageBps: 50,
        intendedRecipient: OTHER_ADDRESS,
      })
    ).toThrow(/output receiver/)
  })

  it.each(['1inch', 'kyber', 'li.fi'] as const)('rejects a one-wei minimum for %s', provider => {
    const data =
      provider === '1inch' ? oneInchCalldata(1n) : provider === 'kyber' ? kyberCalldata(1n) : lifiCalldata(1n)
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider,
        data,
        quotedOutputAmount: '1000000000',
        maxSlippageBps: 100,
      })
    ).toThrow(/below the quote-bound floor/)
  })

  it('uses floor division at exact and one-wei-below boundaries', () => {
    const input = {
      provider: '1inch' as const,
      quotedOutputAmount: '101',
      maxSlippageBps: 100,
    }
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        ...input,
        data: oneInchCalldata(99n),
      })
    ).not.toThrow()
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        ...input,
        data: oneInchCalldata(98n),
      })
    ).toThrow(/below the quote-bound floor/)
  })

  it.each([undefined, -1, 10_001, 0.5, Number.NaN])('rejects invalid slippage %s', maxSlippageBps => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: '1inch',
        data: oneInchCalldata(1n),
        quotedOutputAmount: '100',
        maxSlippageBps,
      })
    ).toThrow(/no valid slippage policy/)
  })

  it.each(['0', '-1', 'not-an-integer'])('rejects non-positive or invalid quote output %s', quotedOutputAmount => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'kyber',
        data: kyberCalldata(100n),
        quotedOutputAmount,
        maxSlippageBps: 100,
      })
    ).toThrow(/destination amount/)
  })

  it('rejects a non-positive known minimum even when the mathematical floor rounds to zero', () => {
    expect(() =>
      assertAggregatorCalldataMinOutputBound({
        provider: 'li.fi',
        data: lifiCalldata(0n),
        quotedOutputAmount: '1',
        maxSlippageBps: 10_000,
      })
    ).toThrow(/minimum output/)
  })

  it('rejects truncated calldata for a recognized selector', () => {
    const data = oneInchCalldata(995_000n).slice(0, 10)
    expect(() => decodeAggregatorCalldataMinOutput({ provider: '1inch', data })).toThrow(
      /recognized calldata selector.*malformed/
    )
  })

  it.each(['1inch', 'kyber', 'li.fi'] as const)(
    'keeps an unknown %s selector available without claiming verification',
    provider => {
      expect(decodeAggregatorCalldataMinOutput({ provider, data: '0xdeadbeef' })).toBeUndefined()
      expect(() =>
        assertAggregatorCalldataMinOutputBound({
          provider,
          data: '0xdeadbeef',
          quotedOutputAmount: '100',
          maxSlippageBps: 100,
        })
      ).not.toThrow()
    }
  )
})

const kyberVariants = parseAbi([
  'function swapGeneric((address callTarget, address approveTarget, bytes targetData, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes clientData) execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
  'function swapSimpleMode(address caller, (address srcToken, address dstToken, address[] srcReceivers, uint256[] srcAmounts, address[] feeReceivers, uint256[] feeAmounts, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags, bytes permit) desc, bytes executorData, bytes clientData) returns (uint256 returnAmount, uint256 gasUsed)',
])

const kyberDescription = (minReturnAmount: bigint) => ({
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
  permit: '0x' as const,
})

const lifiVariants = parseAbi([
  'function swapTokensSingleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit) swapData)',
  'function swapTokensMultipleV3ERC20ToERC20(bytes32 transactionId, string integrator, string referrer, address receiver, uint256 minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] swapData)',
])

const lifiSwapData = {
  callTo: ADDRESS,
  approveTo: ADDRESS,
  sendingAssetId: ADDRESS,
  receivingAssetId: OTHER_ADDRESS,
  fromAmount: 1_000_000n,
  callData: '0x1234' as const,
  requiresDeposit: false,
}

describe('Kyber and LI.FI selector variants', () => {
  it('decodes Kyber swapGeneric and swapSimpleMode', () => {
    const min = 995_000n
    const generic = encodeFunctionData({
      abi: kyberVariants,
      functionName: 'swapGeneric',
      args: [
        {
          callTarget: ADDRESS,
          approveTarget: ADDRESS,
          targetData: '0x',
          desc: kyberDescription(min),
          clientData: '0x',
        },
      ],
    })
    const simple = encodeFunctionData({
      abi: kyberVariants,
      functionName: 'swapSimpleMode',
      args: [ADDRESS, kyberDescription(min), '0x', '0x'],
    })
    for (const data of [generic, simple])
      expect(decodeAggregatorCalldataMinOutput({ provider: 'kyber', data })).toBe(min)
  })

  it('decodes LI.FI single and multiple GenericSwapFacet variants', () => {
    const min = 995_000n
    const common = [BYTES32, 'vultisig-0', 'referrer', ADDRESS, min] as const
    const single = encodeFunctionData({
      abi: lifiVariants,
      functionName: 'swapTokensSingleV3ERC20ToERC20',
      args: [...common, lifiSwapData],
    })
    const multiple = encodeFunctionData({
      abi: lifiVariants,
      functionName: 'swapTokensMultipleV3ERC20ToERC20',
      args: [...common, [lifiSwapData]],
    })
    for (const data of [single, multiple])
      expect(decodeAggregatorCalldataMinOutput({ provider: 'li.fi', data })).toBe(min)
  })
})

describe('request slippage conversion', () => {
  it.each([
    [0.5, 100, 50],
    [1, 100, 100],
    [0.01, 10000, 100],
    [0.0025, 10000, 25],
    [100, 1, 100],
  ])('converts exact API unit %s * %s to %s basis points', (value, scale, expected) => {
    expect(toMaxSlippageBps(value, scale)).toBe(expected)
  })

  it.each([
    [0.005, 100],
    [-1, 100],
    [101, 100],
    [Number.NaN, 1],
  ])('rejects an unrepresentable or invalid request policy', (value, scale) => {
    expect(() => toMaxSlippageBps(value, scale)).toThrow(/integer basis points/)
  })
})
