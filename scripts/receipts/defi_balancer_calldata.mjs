/**
 * Runnable receipt: build UNSIGNED Balancer v3 swap calldata and print its
 * structure. NO RPC, NO signing, NO broadcast.
 *
 * Run with tsx from the sdk package dir (resolves the TS source + the
 * @balancer/sdk dep, which lives in the sdk workspace node_modules):
 *   cd packages/sdk
 *   ../../node_modules/.bin/tsx ../../scripts/receipts/defi_balancer_calldata.mjs
 */
import { buildBalancerV3SwapCalldata } from '../../packages/sdk/src/tools/defi/balancer/index.ts'

const USDC = { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 }
const USDT = { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 }

// Sample mainnet USDC -> USDT single-hop route. Pool addr is illustrative; the
// builder only encodes calldata (it never reads pool state on-chain).
const exactIn = buildBalancerV3SwapCalldata({
  chainId: 1,
  swapKind: 'EXACT_IN',
  paths: [
    {
      pools: ['0x1111111111111111111111111111111111111111'],
      tokens: [USDC, USDT],
      inputAmountRaw: 1_000_000n, // 1 USDC
      outputAmountRaw: 999_000n, // quoted 0.999 USDT
      isBuffer: [false],
    },
  ],
  expectedAmountRaw: 999_000n,
  slippageBps: 50, // 0.5%
  recipient: '0x2222222222222222222222222222222222222222',
  // userData defaults to '0x' (neutral). Affiliate/referral payloads are injectable here.
})

const print = (label, tx) => {
  console.log(`\n=== ${label} ===`)
  console.log('to (BatchRouter):', tx.to)
  console.log('value:           ', tx.value.toString())
  console.log('account:         ', tx.account)
  console.log('swapKind:        ', tx.swapKind)
  console.log('selector:        ', tx.data.slice(0, 10))
  if (tx.minAmountOutRaw !== undefined) console.log('minAmountOutRaw: ', tx.minAmountOutRaw.toString())
  if (tx.maxAmountInRaw !== undefined) console.log('maxAmountInRaw:  ', tx.maxAmountInRaw.toString())
  console.log('data:            ', `${tx.data.slice(0, 74)}… (${(tx.data.length - 2) / 2} bytes)`)
}

print('Balancer v3 EXACT_IN (USDC -> USDT, 0.5% slippage)', exactIn)

// EXACT_OUT variant: want exactly 1 USDT out, quoted ~1.001 USDC in, 1% slippage.
const exactOut = buildBalancerV3SwapCalldata({
  chainId: 1,
  swapKind: 'EXACT_OUT',
  paths: [
    {
      pools: ['0x1111111111111111111111111111111111111111'],
      tokens: [USDC, USDT],
      inputAmountRaw: 1_001_000n,
      outputAmountRaw: 1_000_000n,
      isBuffer: [false],
    },
  ],
  expectedAmountRaw: 1_001_000n,
  slippageBps: 100,
  recipient: '0x2222222222222222222222222222222222222222',
})
print('Balancer v3 EXACT_OUT (USDC -> USDT, 1% slippage)', exactOut)

console.log('\nUNSIGNED calldata only — no signing, no broadcast. ✅')
