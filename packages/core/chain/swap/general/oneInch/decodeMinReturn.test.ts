import { encodeFunctionData, parseAbi } from 'viem'
import { describe, expect, it } from 'vitest'

import { assertOneInchCalldataMinOut, decodeOneInchMinReturn, minAcceptableOneInchOut } from './decodeMinReturn'

const v6Swap = parseAbi([
  'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data)',
])

const unoswap = parseAbi(['function unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex)'])
const unoswapTo = parseAbi([
  'function unoswapTo(uint256 to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex)',
])
const ethUnoswapTo = parseAbi(['function ethUnoswapTo(uint256 to, uint256 minReturn, uint256 dex)'])

const zero = '0x0000000000000000000000000000000000000001'

function encodeV6Swap(minReturnAmount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: v6Swap,
    functionName: 'swap',
    args: [
      zero,
      {
        srcToken: zero,
        dstToken: zero,
        srcReceiver: zero,
        dstReceiver: zero,
        amount: 1_000_000n,
        minReturnAmount,
        flags: 0n,
      },
      '0x',
    ],
  })
}

describe('decodeOneInchMinReturn', () => {
  it('reads minReturnAmount from AggregationRouterV6 swap', () => {
    expect(decodeOneInchMinReturn(encodeV6Swap(995_000n))).toBe(995_000n)
  })

  it('reads minReturn from unoswap', () => {
    const data = encodeFunctionData({
      abi: unoswap,
      functionName: 'unoswap',
      args: [1n, 1_000_000n, 990_000n, 0n],
    })
    expect(decodeOneInchMinReturn(data)).toBe(990_000n)
  })

  it('reads minReturn from unoswapTo', () => {
    const data = encodeFunctionData({
      abi: unoswapTo,
      functionName: 'unoswapTo',
      args: [1n, 1n, 1_000_000n, 989_000n, 0n],
    })
    expect(decodeOneInchMinReturn(data)).toBe(989_000n)
  })

  it('reads minReturn from ethUnoswapTo', () => {
    const data = encodeFunctionData({
      abi: ethUnoswapTo,
      functionName: 'ethUnoswapTo',
      args: [1n, 988_000n, 0n],
    })
    expect(decodeOneInchMinReturn(data)).toBe(988_000n)
  })

  it('returns undefined for unknown selectors (do not brick production)', () => {
    expect(decodeOneInchMinReturn('0xdeadbeef')).toBeUndefined()
    expect(decodeOneInchMinReturn('0xswap')).toBeUndefined()
    expect(decodeOneInchMinReturn('0x')).toBeUndefined()
  })
})

describe('assertOneInchCalldataMinOut', () => {
  it('refuses a known-selector swap whose minReturn is 1 wei against a 1000 USDC quote', () => {
    expect(() => assertOneInchCalldataMinOut(encodeV6Swap(1n), '1000000000', 0.5)).toThrow(
      /minReturn \(1\) is below dstAmount\*\(1-slippage\) floor/
    )
  })

  it('accepts a known-selector swap whose minReturn meets the slippage floor', () => {
    const dstAmount = '1000000000'
    const floor = minAcceptableOneInchOut(dstAmount, 0.5)
    expect(() => assertOneInchCalldataMinOut(encodeV6Swap(floor), dstAmount, 0.5)).not.toThrow()
  })

  it('refuses a known-selector unoswapTo whose minReturn is below the slippage floor', () => {
    const data = encodeFunctionData({
      abi: unoswapTo,
      functionName: 'unoswapTo',
      args: [1n, 1n, 1_000_000n, 1n, 0n],
    })
    expect(() => assertOneInchCalldataMinOut(data, '1000000000', 0.5)).toThrow(
      /minReturn \(1\) is below dstAmount\*\(1-slippage\) floor/
    )
  })

  it('refuses a known-selector ethUnoswapTo whose minReturn is below the slippage floor', () => {
    const data = encodeFunctionData({
      abi: ethUnoswapTo,
      functionName: 'ethUnoswapTo',
      args: [1n, 1n, 0n],
    })
    expect(() => assertOneInchCalldataMinOut(data, '1000000000', 0.5)).toThrow(
      /minReturn \(1\) is below dstAmount\*\(1-slippage\) floor/
    )
  })

  it('does not refuse undecodable calldata', () => {
    expect(() => assertOneInchCalldataMinOut('0xdeadbeef', '1000000000', 0.5)).not.toThrow()
  })
})
