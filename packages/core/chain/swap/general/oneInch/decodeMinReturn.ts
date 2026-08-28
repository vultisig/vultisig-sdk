import { type Abi, decodeFunctionData, parseAbi } from 'viem'

type MinReturnDecoder = {
  abi: Abi
  pick: (args: readonly unknown[]) => bigint | undefined
}

function pickSwapDescriptionMinReturn(args: readonly unknown[]): bigint | undefined {
  const desc = args[1]
  if (Array.isArray(desc) && typeof desc[5] === 'bigint') return desc[5]
  if (desc && typeof desc === 'object' && 'minReturnAmount' in desc) {
    const value = (desc as { minReturnAmount: unknown }).minReturnAmount
    if (typeof value === 'bigint') return value
  }
  return undefined
}

const oneInchMinReturnDecoders: readonly MinReturnDecoder[] = [
  {
    // AggregationRouterV6 classic swap
    abi: parseAbi([
      'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes data)',
    ]) as Abi,
    pick: pickSwapDescriptionMinReturn,
  },
  {
    // AggregationRouterV5 classic swap (extra permit arg)
    abi: parseAbi([
      'function swap(address executor, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 flags) desc, bytes permit, bytes data)',
    ]) as Abi,
    pick: pickSwapDescriptionMinReturn,
  },
  {
    abi: parseAbi(['function unoswap(uint256 token, uint256 amount, uint256 minReturn, uint256 dex)']) as Abi,
    pick: args => (typeof args[2] === 'bigint' ? args[2] : undefined),
  },
  {
    abi: parseAbi([
      'function unoswap2(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)',
    ]) as Abi,
    pick: args => (typeof args[2] === 'bigint' ? args[2] : undefined),
  },
  {
    abi: parseAbi([
      'function unoswap3(uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3)',
    ]) as Abi,
    pick: args => (typeof args[2] === 'bigint' ? args[2] : undefined),
  },
{
  abi: parseAbi(['function unoswapTo(address to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex)']) as Abi,
  pick: args => (typeof args[3] === 'bigint' ? args[3] : undefined),
},
{
  abi: parseAbi([
    'function unoswapTo2(address to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2)',
  ]) as Abi,
  pick: args => (typeof args[3] === 'bigint' ? args[3] : undefined),
},
{
  abi: parseAbi([
    'function unoswapTo3(address to, uint256 token, uint256 amount, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3)',
  ]) as Abi,
  pick: args => (typeof args[3] === 'bigint' ? args[3] : undefined),
},
  {
    abi: parseAbi(['function ethUnoswap(uint256 minReturn, uint256 dex)']) as Abi,
    pick: args => (typeof args[0] === 'bigint' ? args[0] : undefined),
  },
  {
    abi: parseAbi(['function ethUnoswap2(uint256 minReturn, uint256 dex, uint256 dex2)']) as Abi,
    pick: args => (typeof args[0] === 'bigint' ? args[0] : undefined),
  },
  {
    abi: parseAbi(['function ethUnoswap3(uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3)']) as Abi,
    pick: args => (typeof args[0] === 'bigint' ? args[0] : undefined),
  },
  {
    abi: parseAbi(['function ethUnoswapTo(address to, uint256 minReturn, uint256 dex)']) as Abi,
    pick: args => (typeof args[1] === 'bigint' ? args[1] : undefined),
  },
  {
    abi: parseAbi(['function ethUnoswapTo2(address to, uint256 minReturn, uint256 dex, uint256 dex2)']) as Abi,
    pick: args => (typeof args[1] === 'bigint' ? args[1] : undefined),
  },
  {
    abi: parseAbi(['function ethUnoswapTo3(address to, uint256 minReturn, uint256 dex, uint256 dex2, uint256 dex3)']) as Abi,
    pick: args => (typeof args[1] === 'bigint' ? args[1] : undefined),
  },
]

/** Slippage is quoted as a percent (0.5 = 0.5% = 50 bps). */
export function minAcceptableOneInchOut(dstAmount: string, slippagePercent: number): bigint {
  const dst = BigInt(dstAmount)
  if (!Number.isFinite(slippagePercent) || slippagePercent < 0) {
    throw new Error(`1inch min-out check: invalid slippage percent ${slippagePercent}`)
  }
  const bps = BigInt(Math.round(slippagePercent * 100))
  if (bps >= 10_000n) return 0n
  return (dst * (10_000n - bps)) / 10_000n
}

/**
 * Decode `minReturn` / `minReturnAmount` from known 1inch V5/V6 selectors.
 * Unknown or undecodable calldata returns `undefined` — callers must not treat
 * that as a failure (new 1inch selectors would otherwise brick honest swaps).
 */
export function decodeOneInchMinReturn(data: string): bigint | undefined {
  if (typeof data !== 'string' || !data.startsWith('0x') || data.length < 10) return undefined

  for (const decoder of oneInchMinReturnDecoders) {
    try {
      const decoded = decodeFunctionData({ abi: decoder.abi, data: data as `0x${string}` })
      const minReturn = decoder.pick(decoded.args ?? [])
      if (typeof minReturn === 'bigint') return minReturn
    } catch {
      // try the next known selector
    }
  }

  return undefined
}

/**
 * Fail-closed for *known* 1inch selectors: refuse if calldata min-out is below
 * `dstAmount * (1 - slippage)`. Unknown selectors are left signable.
 */
export function assertOneInchCalldataMinOut(data: string, dstAmount: string, slippagePercent: number): void {
  const decoded = decodeOneInchMinReturn(data)
  if (decoded === undefined) return

  const floor = minAcceptableOneInchOut(dstAmount, slippagePercent)
  if (decoded < floor) {
    throw new Error(
      `1inch calldata minReturn (${decoded.toString()}) is below dstAmount*(1-slippage) floor (${floor.toString()}); refusing to sign.`
    )
  }
}
