/**
 * On-chain Uniswap V2 exact-in quote.
 *
 * Ported from mcp-ts `src/tools/uniswap/v2-quote.ts` into the SDK so the
 * constant-product math + on-chain reserve reads live next to the other EVM
 * read primitives instead of being duplicated per consumer.
 *
 * Read-only: reads the official V2 factory, pair reserves, and token
 * metadata via `evmCall` (eth_call). Does NOT build Router02 calldata, does
 * NOT sign, does NOT broadcast. Reserve math assumes standard non-rebasing
 * ERC-20s with no fee-on-transfer tax.
 */
import { EvmChain } from '@vultisig/core-chain/Chain'
import { encodeAbiParameters, formatUnits, getAddress, isAddress, parseAbiParameters, parseUnits } from 'viem'

import { evmCall } from '../evm'
import { decodeAddress, readDecimals, readSymbol } from './_erc20'
import { resolveUniV2Token, UNI_V2_DEPLOYMENTS } from './uniswapV2Addresses'

const SEL = {
  getPair: '0xe6a43905',
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  getReserves: '0x0902f1ac',
} as const

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

export type UniswapV2QuoteParams = {
  chain: EvmChain
  /** Input token address (0x-prefixed), or 'native' for wrapped native. */
  tokenIn: string
  /** Output token address (0x-prefixed), or 'native' for wrapped native. */
  tokenOut: string
  /** Human-readable exact input amount, e.g. "1" or "0.25". */
  amountIn: string
}

export type UniswapV2Quote = {
  protocol: 'uniswap-v2'
  action: 'quote_exact_in'
  status: 'read_only'
  chain: EvmChain
  chainId: number
  factory: `0x${string}`
  router02: `0x${string}`
  pairAddress: `0x${string}`
  tokenIn: `0x${string}`
  tokenInSymbol: string
  tokenInDecimals: number
  tokenOut: `0x${string}`
  tokenOutSymbol: string
  tokenOutDecimals: number
  amountIn: string
  amountInRaw: string
  amountOut: string
  amountOutRaw: string
  reserveInRaw: string
  reserveOutRaw: string
  feeBps: number
  blockTimestampLast: number
}

function encodeGetPair(tokenA: `0x${string}`, tokenB: `0x${string}`): `0x${string}` {
  const encoded = encodeAbiParameters(parseAbiParameters('address, address'), [tokenA, tokenB])
  return (SEL.getPair + encoded.slice(2)) as `0x${string}`
}

function decodeReserves(data: `0x${string}`): {
  reserve0: bigint
  reserve1: bigint
  blockTimestampLast: number
} {
  if (!data || data === '0x') {
    throw new Error('pair returned empty getReserves() response.')
  }
  // getReserves() returns (uint112 reserve0, uint112 reserve1, uint32 ts) ABI-padded to 32 bytes each.
  const hex = data.slice(2)
  const reserve0 = BigInt('0x' + hex.slice(0, 64))
  const reserve1 = BigInt('0x' + hex.slice(64, 128))
  const blockTimestampLast = Number(BigInt('0x' + hex.slice(128, 192)))
  return { reserve0, reserve1, blockTimestampLast }
}

/**
 * Canonical Uniswap V2 constant-product getAmountOut. 0.3% fee baked in
 * (997/1000). Pure bigint, no precision loss.
 */
export function getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) throw new Error('amount must be positive.')
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error('pair has no usable liquidity.')
  }
  const amountInWithFee = amountIn * 997n
  return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee)
}

/**
 * Fetch a read-only Uniswap V2 exact-in quote for a direct pair on a
 * supported EVM chain. Reads factory → pair → reserves + token metadata and
 * applies the constant-product formula.
 */
export async function uniswapV2Quote(params: UniswapV2QuoteParams): Promise<UniswapV2Quote> {
  const { chain } = params
  const deployment = UNI_V2_DEPLOYMENTS[chain]
  if (!deployment) {
    const supported = Object.keys(UNI_V2_DEPLOYMENTS).join(', ')
    throw new Error(`Uniswap V2 is not deployed on ${chain}. Supported: ${supported}.`)
  }

  const tokenInRaw = resolveUniV2Token(params.tokenIn, chain)
  const tokenOutRaw = resolveUniV2Token(params.tokenOut, chain)
  if (!isAddress(tokenInRaw)) throw new Error(`invalid tokenIn: "${params.tokenIn}".`)
  if (!isAddress(tokenOutRaw)) throw new Error(`invalid tokenOut: "${params.tokenOut}".`)

  const tokenIn = getAddress(tokenInRaw)
  const tokenOut = getAddress(tokenOutRaw)
  if (tokenIn === tokenOut) throw new Error('tokenIn and tokenOut must be different.')

  const pairRaw = await evmCall(chain, {
    to: deployment.factory,
    data: encodeGetPair(tokenIn, tokenOut),
  })
  const pairAddress = decodeAddress(pairRaw)
  if (pairAddress === ZERO_ADDRESS) {
    throw new Error(`Uniswap V2 pair not found for ${tokenIn}/${tokenOut} on ${chain}.`)
  }

  const [pairToken0Raw, , reservesRaw, inDecimals, outDecimals, inSymbol, outSymbol] = await Promise.all([
    evmCall(chain, { to: pairAddress, data: SEL.token0 as `0x${string}` }),
    evmCall(chain, { to: pairAddress, data: SEL.token1 as `0x${string}` }),
    evmCall(chain, { to: pairAddress, data: SEL.getReserves as `0x${string}` }),
    readDecimals(chain, tokenIn),
    readDecimals(chain, tokenOut),
    readSymbol(chain, tokenIn),
    readSymbol(chain, tokenOut),
  ])

  const pairToken0 = decodeAddress(pairToken0Raw)
  const amountInRaw = parseUnits(params.amountIn.trim(), inDecimals)
  const { reserve0, reserve1, blockTimestampLast } = decodeReserves(reservesRaw)
  // token0 is the lexicographically smaller address; map reserves to in/out.
  const inIsToken0 = pairToken0 === tokenIn
  const reserveIn = inIsToken0 ? reserve0 : reserve1
  const reserveOut = inIsToken0 ? reserve1 : reserve0
  const amountOutRaw = getAmountOut(amountInRaw, reserveIn, reserveOut)

  return {
    protocol: 'uniswap-v2',
    action: 'quote_exact_in',
    status: 'read_only',
    chain,
    chainId: deployment.chainId,
    factory: deployment.factory,
    router02: deployment.router02,
    pairAddress,
    tokenIn,
    tokenInSymbol: inSymbol,
    tokenInDecimals: inDecimals,
    tokenOut,
    tokenOutSymbol: outSymbol,
    tokenOutDecimals: outDecimals,
    amountIn: params.amountIn.trim(),
    amountInRaw: amountInRaw.toString(),
    amountOut: formatUnits(amountOutRaw, outDecimals),
    amountOutRaw: amountOutRaw.toString(),
    reserveInRaw: reserveIn.toString(),
    reserveOutRaw: reserveOut.toString(),
    feeBps: 30,
    blockTimestampLast,
  }
}
