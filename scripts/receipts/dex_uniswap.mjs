/**
 * Runnable receipt for sdk.dex.uniswap — reads a LIVE Uniswap V3 pool
 * (USDC/WETH 0.05% on Ethereum mainnet) over RPC, prints pool state, and
 * cross-checks the on-chain `current_tick` against the price recomputed from
 * the canonical tick-math path. Pure read: no signing, no broadcast.
 *
 * Run:  node scripts/receipts/dex_uniswap.mjs
 */
import { dex } from '../../packages/sdk/src/index.ts'

const {
  formatPrice18,
  getSqrtRatioAtTick,
  priceToTick,
  sqrtPriceToPriceMantissa,
  uniswapV3PoolInfo,
} = dex.uniswap

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

async function main() {
  console.log('=== sdk.dex.uniswap receipt — LIVE Uniswap V3 read (no broadcast) ===\n')

  // Live on-chain read of the canonical USDC/WETH 0.05% pool.
  const pool = await uniswapV3PoolInfo({
    chain: 'Ethereum',
    tokenA: USDC,
    tokenB: 'native', // WETH
    fee: 500,
  })

  console.log('pool_address          ', pool.poolAddress)
  console.log('pair                  ', `${pool.token0Symbol}(${pool.token0Decimals}) / ${pool.token1Symbol}(${pool.token1Decimals})`)
  console.log('fee / tick_spacing    ', `${pool.fee} / ${pool.tickSpacing}`)
  console.log('sqrtPriceX96          ', pool.sqrtPriceX96)
  console.log('current_tick          ', pool.currentTick)
  console.log('liquidity             ', pool.liquidity)
  console.log('price token0->token1  ', pool.priceToken0InToken1, `(${pool.token0Symbol} in ${pool.token1Symbol})`)
  console.log('price token1->token0  ', pool.priceToken1InToken0, `(${pool.token1Symbol} in ${pool.token0Symbol})`)

  // Pure tick-math cross-check: recompute price from current_tick via the
  // canonical getSqrtRatioAtTick path, then derive the tick back from price.
  const { mantissa, scale } = sqrtPriceToPriceMantissa(
    getSqrtRatioAtTick(pool.currentTick),
    pool.token0Decimals,
    pool.token1Decimals,
  )
  const priceFromTick = formatPrice18(mantissa, scale)
  const tickFromPrice = priceToTick(Number(priceFromTick), pool.token0Decimals, pool.token1Decimals)

  console.log('\n--- pure tick-math cross-check ---')
  console.log('price @ current_tick  ', priceFromTick)
  console.log('tick recovered        ', tickFromPrice)
  console.log('round-trips to tick   ', tickFromPrice === pool.currentTick ? 'OK ✓' : `MISMATCH (${tickFromPrice} != ${pool.currentTick})`)

  if (tickFromPrice !== pool.currentTick) {
    throw new Error('tick round-trip mismatch')
  }
  console.log('\nRECEIPT OK')
}

main().catch((e) => {
  console.error('RECEIPT FAILED:', e)
  process.exit(1)
})
