#!/usr/bin/env node
/**
 * Runnable receipt for sdk.swap.skip — fetches a LIVE Skip Go route + builds the
 * unsigned cross-chain swap envelope (OSMO → ATOM by default) and prints the
 * route + unsigned msgs. Hits the live Skip API; NEVER signs or broadcasts.
 *
 * Run from packages/sdk:
 *   node --import tsx scripts/receipts/swap_skip.mjs
 * or:
 *   yarn workspace @vultisig/sdk exec node --import tsx scripts/receipts/swap_skip.mjs
 *
 * Optional env:
 *   SKIP_FROM_ADDR / SKIP_TO_ADDR — override the placeholder addresses.
 */
import { runSkipSwap } from '../../src/tools/swap/skip/index.ts'

// Placeholder bech32 addresses — valid-shape osmo1.../cosmos1... so the local
// guard passes. Skip's /msgs_direct accepts them for envelope-building; we never
// sign or broadcast, so no funds move and the addresses need not be funded.
const FROM = process.env.SKIP_FROM_ADDR ?? 'osmo1clpqr4nrk4khgkxj78fcwwh6dl3uw4epasmvnj'
const TO = process.env.SKIP_TO_ADDR ?? 'cosmos1a8l3srqyk5krvzhkt7cyzy52yxcght6322w2qy'

const args = {
  fromAddress: FROM,
  toAddress: TO,
  sourceChainId: 'osmosis-1',
  sourceAssetDenom: 'uosmo',
  destChainId: 'cosmoshub-4',
  destAssetDenom: 'uatom',
  // 5 OSMO (6-decimals) — well above any notional floor, deep pool.
  amountIn: '5000000',
}

console.log('=== sdk.swap.skip — LIVE Skip Go route + unsigned tx prep ===')
console.log('request:', JSON.stringify(args, null, 2))

const out = await runSkipSwap(args)

if (!out.ok) {
  console.log('\noutcome: NOT-OK (structured envelope, no funds moved)')
  console.log(JSON.stringify(out.envelope, null, 2))
  // A structured envelope is still a valid receipt of the pure-crypto path —
  // exit 0 so the receipt is reproducible even if Skip rate-limits/reshapes.
  process.exit(0)
}

console.log('\noutcome: OK')
console.log('route_description :', out.quote.route_description)
console.log('amount_in         :', out.quote.amount_in, 'uosmo')
console.log('expected_amount_out:', out.quote.expected_amount_out, 'uatom')
console.log('min_amount_out    :', out.quote.min_amount_out, 'uatom')
console.log('slippage_bps      :', out.quote.slippage_bps)
console.log('usd_amount_in     :', out.quote.usd_amount_in)
console.log('usd_amount_out    :', out.quote.usd_amount_out)
console.log('swap_venue        :', out.quote.swap_venue)
console.log('price_impact_%    :', out.quote.swap_price_impact_percent)
console.log('multi_tx          :', out.multi_tx, '(tx_count=' + out.tx_count + ')')
console.log('skip_chain_path   :', out.metadata.skip_chain_path.join(' -> '))
console.log('settlement_seconds:', out.metadata.settlement_estimate_seconds)
console.log('\nunsigned_msgs (NOT signed, NOT broadcast):')
for (const [i, m] of out.unsigned_msgs.entries()) {
  console.log(`  [${i}] chain_id=${m.chain_id} signing_method=${m.signing_method}`)
  if (m.signing_method === 'cosmos') {
    console.log(`      msgs=${m.cosmos_tx.msgs.map(x => x.msg_type_url).join(', ')}`)
  } else {
    console.log(`      to=${m.evm_tx.to} value=${m.evm_tx.value} data=${m.evm_tx.data.slice(0, 18)}...`)
  }
}
console.log('\nrelay-safe: this script quotes + builds-unsigned only. No keys, no signing, no broadcast.')
