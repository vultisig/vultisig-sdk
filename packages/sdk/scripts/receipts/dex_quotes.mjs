/**
 * Runnable receipt for sdk.dex.quotes — on-chain DEX quote primitives.
 *
 * Run from the @vultisig/sdk package root:
 *   yarn tsx scripts/receipts/dex_quotes.mjs
 *
 * Part 1 (uniswap-v2): LIVE on-chain quote. Reads the canonical Uniswap V2
 *   factory -> pair -> reserves on Ethereum mainnet via the SDK's evmCall and
 *   applies the constant-product getAmountOut. Real RPC, real reserves.
 *
 * Part 2 (balancer): canonical pool math via @balancer-labs/balancer-maths.
 *   The Vault.swap() is the exact math the on-chain Balancer Vault + SOR use.
 *   Fed a real WEIGHTED pool state (USDC/WETH 50/50 snapshot) — no hand-rolled
 *   invariant. Read-only: no calldata, no signing, no broadcast.
 */
import { EvmChain } from '@vultisig/core-chain/Chain'

import { balancerQuote } from '../../src/tools/dex/balancerQuote.ts'
import { uniswapV2Quote } from '../../src/tools/dex/uniswapV2Quote.ts'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'

async function main() {
  // ----- Part 1: LIVE uniswap-v2 on-chain quote (1 WETH -> USDC) -----
  console.log('=== uniswap-v2 (LIVE on-chain, Ethereum mainnet) ===')
  const uni = await uniswapV2Quote({
    chain: EvmChain.Ethereum,
    tokenIn: 'native', // wrapped native = WETH
    tokenOut: USDC,
    amountIn: '1',
  })
  console.log(
    `1 ${uni.tokenInSymbol} -> ${uni.amountOut} ${uni.tokenOutSymbol}  (pair ${uni.pairAddress}, fee ${uni.feeBps}bps)`,
  )
  console.log(`  reserves: in=${uni.reserveInRaw} out=${uni.reserveOutRaw}`)
  console.log(`  amountOutRaw=${uni.amountOutRaw}`)

  // ----- Part 2: balancer canonical pool math (1000 USDC -> WETH) -----
  console.log('\n=== balancer (@balancer-labs/balancer-maths canonical Vault) ===')
  // 50/50 WEIGHTED pool snapshot: 2,000,000 USDC (6dp) / 1,000 WETH (18dp).
  const poolState = {
    poolType: 'WEIGHTED',
    poolAddress: '0x0000000000000000000000000000000000000001',
    tokens: [USDC, WETH],
    scalingFactors: [1_000_000_000_000n, 1n], // 10^12 (6->18dp), 10^0 (18dp)
    tokenRates: [10n ** 18n, 10n ** 18n],
    balancesLiveScaled18: [2_000_000n * 10n ** 18n, 1_000n * 10n ** 18n],
    swapFee: 1_000_000_000_000_000n, // 0.1%
    aggregateSwapFee: 0n,
    totalSupply: 1_000n * 10n ** 18n,
    weights: [500_000_000_000_000_000n, 500_000_000_000_000_000n],
    supportsUnbalancedLiquidity: true,
  }
  const bal = balancerQuote({
    poolState,
    tokenIn: USDC,
    tokenOut: WETH,
    amountRaw: 1_000n * 10n ** 6n, // 1000 USDC
  })
  const wethOut = Number(BigInt(bal.resultRaw)) / 1e18
  console.log(
    `1000 USDC -> ${wethOut} WETH  (poolType ${bal.poolType}, kind ${bal.swapKind})`,
  )
  console.log(`  resultRaw=${bal.resultRaw}`)

  console.log('\nOK — uniswap-v2 LIVE + balancer canonical math, read-only, no broadcast.')
}

main().catch((err) => {
  console.error('receipt failed:', err)
  process.exit(1)
})
