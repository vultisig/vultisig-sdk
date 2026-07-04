/**
 * Runnable receipt for sdk.swap.astroport (Terra Astroport in-chain swap).
 *
 * Hits the LIVE phoenix-1 LCD (terra-lcd.publicnode.com) to quote a real
 * uluna → ASTRO swap via the Astroport router's simulate_swap_operations
 * smart query, then builds and prints the UNSIGNED wasm_execute envelope.
 *
 * NO signing, NO broadcast — pure quote + build.
 *
 *   node --import tsx scripts/receipts/swap_astroport.mjs
 */
import { buildAstroportSwap } from '../../packages/sdk/src/tools/swap/astroport.ts'

// Live ASTRO CW20 on phoenix-1.
const ASTRO_CW20 =
  'terra1nsuqsk6kh58ulczatwev87ttq2z6r3pusulg9r24mfj2fvtzd4uq3exn26'
// Dummy vault sender (valid terra1 bech32 — never funded, never signed).
const VAULT = 'terra1dcegyrekltswvyy0xy69ydgxn9x8x32zdtapd8'

const params = {
  fromAddress: VAULT,
  offerAssetDenom: 'uluna',
  offerAmount: '1000000', // 1 LUNA
  askAssetDenom: ASTRO_CW20,
  slippageTolerance: 0.01,
}

console.log('=== sdk.swap.astroport receipt (LIVE phoenix-1 LCD) ===')
console.log('params:', JSON.stringify(params, null, 2))

const result = await buildAstroportSwap(params)

console.log('\n--- unsigned wasm_execute envelope ---')
console.log(JSON.stringify(result, null, 2))

console.log('\n--- decoded execute_msg ---')
console.log(JSON.stringify(JSON.parse(result.executeMsg), null, 2))

// Light assertions so a broken build fails the receipt loudly.
if (result.txType !== 'wasm_execute') throw new Error('txType mismatch')
if (result.contractAddress !== params.askAssetDenom && result.funds.length !== 1)
  throw new Error('native offer should carry funds')
if (BigInt(result.quote.minReceive) > BigInt(result.quote.expectedAskAmount))
  throw new Error('minReceive must be <= expectedAskAmount')
if (result.recipientMode !== 'self')
  throw new Error('expected self recipient default')

console.log('\nOK: live quote =', result.quote.expectedAskAmount, 'uASTRO base units')
console.log('OK: min_receive (1% slippage) =', result.quote.minReceive)
console.log('OK: built unsigned envelope, no broadcast.')
