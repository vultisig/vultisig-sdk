/**
 * Uniswap V3 pool-info — read on-chain pool state (address, liquidity,
 * sqrtPriceX96, current tick, token metadata) for a token pair + fee tier,
 * or for a known pool address.
 *
 * Pure read path: every chain interaction is an eth_call via the SDK's
 * `evmCall`. NEVER signs, NEVER broadcasts. Prices are computed off the
 * on-chain sqrtPriceX96 with BigInt fixed-point math (≥18 sig figs).
 *
 * Ported from vultisig/mcp-ts `src/tools/uniswap/pool-info.ts`.
 * Part of the mcp-ts/backend → SDK code-as-action consolidation.
 */
import { decodeAbiParameters, encodeAbiParameters, getAddress, isAddress, parseAbiParameters } from 'viem'

import type { EvmChain } from '../../../types'
import { evmCall } from '../../evm'
import { resolveNativeToken, supportedUniV3Chains, UNI_V3_FACTORY } from './addresses'
import { decodeAddress, readDecimals, readSymbol } from './erc20'
import { formatPrice18, sqrtPriceToPriceMantissa, UNI_V3_TICK_SPACING } from './tickMath'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// Selectors (first 4 bytes of keccak256 of the function signature).
const SEL = {
  getPool: '0x1698ee82', // getPool(address,address,uint24)
  token0: '0x0dfe1681',
  token1: '0xd21220a7',
  slot0: '0x3850c7bd',
  liquidity: '0x1a686502',
  fee: '0xddca3f43', // pool.fee() returns uint24
} as const

export type UniswapV3PoolInfoParams = {
  /** EVM chain the pool lives on. Must be a supported Uniswap V3 chain. */
  chain: EvmChain
  /** Known pool address. If set, tokenA/tokenB/fee are only used for cross-check. */
  poolAddress?: string
  /** First token address (0x-prefixed). Use 'native' for the chain's wrapped native. */
  tokenA?: string
  /** Second token address (0x-prefixed). Use 'native' for the chain's wrapped native. */
  tokenB?: string
  /** Fee tier in hundredths of a bip (100, 500, 3000, 10000). Default 3000. */
  fee?: number
}

export type UniswapV3PoolInfo = {
  chain: EvmChain
  poolAddress: `0x${string}`
  token0: `0x${string}`
  token0Symbol: string
  token0Decimals: number
  token1: `0x${string}`
  token1Symbol: string
  token1Decimals: number
  fee: number
  tickSpacing: number
  sqrtPriceX96: string
  currentTick: number
  liquidity: string
  /** Human price of token0 denominated in token1, 18 sig figs. */
  priceToken0InToken1: string
  /** Human price of token1 denominated in token0, 18 sig figs. */
  priceToken1InToken0: string
}

function chainDesc(): string {
  return supportedUniV3Chains().join(', ')
}

function encodeGetPool(tokenA: `0x${string}`, tokenB: `0x${string}`, fee: number): `0x${string}` {
  const encoded = encodeAbiParameters(parseAbiParameters('address, address, uint24'), [tokenA, tokenB, fee])
  return (SEL.getPool + encoded.slice(2)) as `0x${string}`
}

function decodeSlot0(data: `0x${string}`): { sqrtPriceX96: bigint; tick: number } {
  // slot0 returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool).
  const [sqrtPriceX96, tick] = decodeAbiParameters(
    parseAbiParameters('uint160, int24, uint16, uint16, uint16, uint8, bool'),
    data
  )
  return { sqrtPriceX96, tick }
}

function decodeUint(data: `0x${string}`): bigint {
  if (!data || data === '0x') return 0n
  return BigInt(data)
}

/**
 * Verify a supplied poolAddress is the canonical factory pool for a token pair
 * + fee. Throws if the factory resolves the pair to a different (or zero)
 * address — i.e. the supplied address is not a genuine Uniswap V3 pool for it.
 */
async function assertCanonicalPool(
  chain: EvmChain,
  factoryAddr: `0x${string}`,
  poolAddr: `0x${string}`,
  tokenA: string,
  tokenB: string,
  fee: number
): Promise<void> {
  const tA = resolveNativeToken(tokenA, chain)
  const tB = resolveNativeToken(tokenB, chain)
  if (!isAddress(tA) || !isAddress(tB)) return
  const expectRaw = await evmCall(chain, {
    to: factoryAddr,
    data: encodeGetPool(getAddress(tA), getAddress(tB), fee),
  })
  const expectPool = decodeAddress(expectRaw)
  if (expectPool === ZERO_ADDRESS || getAddress(expectPool) !== poolAddr) {
    throw new Error(
      `poolAddress ${poolAddr} is not the canonical Uniswap V3 pool for ` +
        `${tA}/${tB} fee ${fee} on ${chain} (factory returned ${expectPool}).`
    )
  }
}

/**
 * Read Uniswap V3 pool state. Either pass `poolAddress` for a known pool, or
 * `(tokenA, tokenB, fee)` to look it up via the factory.
 *
 * @example
 * ```ts
 * const pool = await uniswapV3PoolInfo({
 *   chain: 'Ethereum',
 *   tokenA: 'native',                                       // WETH
 *   tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',   // USDC
 *   fee: 500,
 * })
 * console.log(pool.currentTick, pool.priceToken0InToken1)
 * ```
 */
export async function uniswapV3PoolInfo(params: UniswapV3PoolInfoParams): Promise<UniswapV3PoolInfo> {
  const chain = params.chain
  const factoryAddr = UNI_V3_FACTORY[chain]
  if (!factoryAddr) {
    throw new Error(`Uniswap V3 is not deployed on ${chain}. Supported: ${chainDesc()}.`)
  }

  // Resolve pool address — either given or looked up via factory.
  let poolAddr: `0x${string}`

  if (params.poolAddress) {
    if (!isAddress(params.poolAddress)) {
      throw new Error(`invalid poolAddress: "${params.poolAddress}".`)
    }
    poolAddr = getAddress(params.poolAddress)
    // fee() is read and cross-checked against params.fee below in the parallel
    // batch. When tokenA/tokenB are ALSO supplied, the canonical factory is
    // queried to prove this address is a genuine Uniswap V3 pool for that pair
    // (see post-batch verification) — otherwise an arbitrary contract that can
    // answer token0/token1/slot0/liquidity/fee could return an attacker-chosen
    // price. With only a bare poolAddress and no pair, the caller is trusting
    // the address it supplied (read-only quote, no signing).
  } else {
    const fee = params.fee ?? 3000
    if (!params.tokenA || !params.tokenB) {
      throw new Error('Provide either poolAddress, or both tokenA and tokenB (plus optional fee).')
    }
    if (!UNI_V3_TICK_SPACING[fee]) {
      throw new Error(`unsupported fee tier: ${fee} (valid: 100, 500, 3000, 10000).`)
    }
    const tokenAStr = resolveNativeToken(params.tokenA, chain)
    const tokenBStr = resolveNativeToken(params.tokenB, chain)
    if (!isAddress(tokenAStr)) throw new Error(`invalid tokenA: "${params.tokenA}".`)
    if (!isAddress(tokenBStr)) throw new Error(`invalid tokenB: "${params.tokenB}".`)
    const tokenA = getAddress(tokenAStr)
    const tokenB = getAddress(tokenBStr)

    const data = encodeGetPool(tokenA, tokenB, fee)
    const raw = await evmCall(chain, { to: factoryAddr, data })
    poolAddr = decodeAddress(raw)
    if (poolAddr === ZERO_ADDRESS) {
      throw new Error(`pool not found for ${tokenAStr}/${tokenBStr} fee ${fee} on ${chain}.`)
    }
  }

  // Fetch pool state in parallel. When poolAddress was supplied, also fetch
  // fee() in the same batch and cross-check args.fee afterwards.
  const readFeeFromPool = params.poolAddress != null
  const [token0Raw, token1Raw, slot0Raw, liqRaw, feeRaw] = await Promise.all([
    evmCall(chain, { to: poolAddr, data: SEL.token0 }),
    evmCall(chain, { to: poolAddr, data: SEL.token1 }),
    evmCall(chain, { to: poolAddr, data: SEL.slot0 }),
    evmCall(chain, { to: poolAddr, data: SEL.liquidity }),
    readFeeFromPool ? evmCall(chain, { to: poolAddr, data: SEL.fee }) : Promise.resolve('0x' as `0x${string}`),
  ])

  let fee: number
  if (readFeeFromPool) {
    if (!feeRaw || feeRaw === '0x') {
      throw new Error(`pool ${poolAddr} returned empty fee() — is this address a Uniswap V3 pool contract?`)
    }
    const poolFee = Number(decodeUint(feeRaw))
    if (params.fee != null && params.fee !== poolFee) {
      throw new Error(`fee mismatch: pool ${poolAddr} has fee ${poolFee}, but params.fee=${params.fee}.`)
    }
    fee = poolFee
    if (!UNI_V3_TICK_SPACING[fee]) {
      throw new Error(`unsupported fee tier: ${fee} (valid: 100, 500, 3000, 10000).`)
    }
  } else {
    fee = params.fee ?? 3000
  }

  // Empty liquidity() is a "not a pool" signal, same as empty fee().
  if (!liqRaw || liqRaw === '0x') {
    throw new Error(`pool ${poolAddr} returned empty liquidity() — is this address a Uniswap V3 pool contract?`)
  }

  const token0 = decodeAddress(token0Raw)
  const token1 = decodeAddress(token1Raw)
  const { sqrtPriceX96, tick } = decodeSlot0(slot0Raw)
  const liquidity = decodeUint(liqRaw)

  // A live (initialized) Uniswap V3 pool always has a non-zero sqrtPriceX96.
  // A zero here means either an uninitialized pool or a non-pool contract that
  // answered slot0() with zero-padded data — fail closed rather than fabricate
  // a '0'/'0' price pair that a caller could mistake for a real quote.
  if (sqrtPriceX96 === 0n) {
    throw new Error(`pool ${poolAddr} returned sqrtPriceX96=0 — uninitialized pool or not a Uniswap V3 pool contract.`)
  }

  // When a poolAddress was supplied alongside a token pair, prove the address
  // is the canonical factory pool for (token0, token1, fee). Without this an
  // arbitrary contract masquerading as a pool could return an attacker-chosen
  // price. Only enforced when the caller gave both tokens — a bare poolAddress
  // is taken on the caller's own trust (read-only quote, no signing).
  if (params.poolAddress && params.tokenA && params.tokenB) {
    await assertCanonicalPool(chain, factoryAddr, poolAddr, params.tokenA, params.tokenB, fee)
  }

  const [dec0, dec1, sym0, sym1] = await Promise.all([
    readDecimals(chain, token0),
    readDecimals(chain, token1),
    readSymbol(chain, token0),
    readSymbol(chain, token1),
  ])

  // Compute prices via BigInt mantissa to preserve 18-sig-fig precision.
  const { mantissa: m01, scale: s01 } = sqrtPriceToPriceMantissa(sqrtPriceX96, dec0, dec1)
  const price01 = formatPrice18(m01, s01)
  let price10: string
  if (m01 === 0n) {
    price10 = '0'
  } else {
    // inverse: 1 / (m01 / 10^s01) = 10^(s01 + PRECISION_BUFFER) / m01, formatted
    // back against PRECISION_BUFFER. 80 covers the full V3 tick range.
    const PRECISION_BUFFER = 80
    const inverseMantissa = 10n ** BigInt(s01 + PRECISION_BUFFER) / m01
    price10 = formatPrice18(inverseMantissa, PRECISION_BUFFER)
  }

  return {
    chain,
    poolAddress: poolAddr,
    token0,
    token0Symbol: sym0,
    token0Decimals: dec0,
    token1,
    token1Symbol: sym1,
    token1Decimals: dec1,
    fee,
    tickSpacing: UNI_V3_TICK_SPACING[fee]!,
    sqrtPriceX96: sqrtPriceX96.toString(),
    currentTick: tick,
    liquidity: liquidity.toString(),
    priceToken0InToken1: price01,
    priceToken1InToken0: price10,
  }
}
