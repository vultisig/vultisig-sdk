#!/usr/bin/env node
// Runnable receipt for sdk.defi.pendle — BUILDS an UNSIGNED PT-buy tx.
//
// Run from repo root:
//   node --import tsx scripts/receipts/defi_pendle.mjs
//
// What it does (NO broadcast, NO signing):
//   1. Fetches LIVE active Pendle markets on Ethereum via sdk.defi.pendle.markets.
//   2. Picks the deepest-liquidity market and builds an UNSIGNED buy-PT router
//      tx (+ ERC20 approve leg) via sdk.defi.pendle.buildBuyPt.
//   3. Prints the unsigned tx structure.
//
// Network-dependent (hits Pendle's public Hosted SDK REST API). If the API is
// unreachable it prints a clear OFFLINE notice and exits non-zero.

import { pendle } from '../../packages/sdk/src/tools/defi/pendle/index.ts'

const CHAIN = 'Ethereum'
// Any address works — Convert returns calldata for this receiver; we never sign.
const SAMPLE_FROM = '0x1111111111111111111111111111111111111111'

const j = obj => JSON.stringify(obj, null, 2)

async function main() {
  console.log('=== sdk.defi.pendle receipt — UNSIGNED PT-buy build ===\n')
  console.log(`chain: ${CHAIN}`)
  console.log(`router (allow-listed): ${pendle.ROUTER_V4}`)
  console.log(`supported chains: ${pendle.SUPPORTED_CHAINS.join(', ')}\n`)

  console.log('[1/2] fetching live active Pendle markets…')
  const markets = await pendle.markets({ chain: CHAIN, limit: 5 })
  if (!markets.length) throw new Error('no active markets returned')
  console.log(`  got ${markets.length} markets (top by liquidity):`)
  for (const m of markets) {
    console.log(
      `   - ${m.name}  pt=${m.pt}  fixedAPY=${m.ptFixedApy != null ? (m.ptFixedApy * 100).toFixed(2) + '%' : 'n/a'}  liq=$${m.liquidityUsd?.toLocaleString() ?? '?'}`
    )
  }

  const target = markets[0]
  console.log(`\n[2/2] building UNSIGNED buy-PT for: ${target.name}`)
  // 1 unit of underlying in base units. USDC=6 decimals → 1_000000; if the
  // underlying is 18-dec the Convert min-valuation floor still passes for $1+.
  const amount = '1000000'
  const res = await pendle.buildBuyPt({
    chain: CHAIN,
    market: target.market,
    pt: target.pt,
    underlying: target.underlying,
    amount,
    from: SAMPLE_FROM,
    slippage: 1,
    // affiliate intentionally OMITTED → neutral/off (multi-consumer SDK).
  })

  console.log('\n--- UNSIGNED ROUTER TX ---')
  console.log(j({ ...res.tx, data: res.tx.data.slice(0, 42) + `… (${res.tx.data.length} chars)` }))
  if (res.approval) {
    console.log('\n--- UNSIGNED APPROVE LEG (signed first) ---')
    console.log(j(res.approval))
  }
  console.log('\n--- SIGNING STEPS ---')
  console.log(j(res.steps))
  console.log('\n--- META ---')
  console.log(j(res.meta))

  // Hard invariants the receipt proves.
  const ok =
    res.tx.to.toLowerCase() === pendle.ROUTER_V4.toLowerCase() &&
    res.tx.data.startsWith('0x') &&
    res.tx.from === SAMPLE_FROM &&
    res.meta.note.includes('UNSIGNED')
  if (!ok) throw new Error('receipt invariant failed')
  console.log('\n✅ UNSIGNED PT-buy tx built. Router allow-listed, never signed, never broadcast.')
}

main().catch(err => {
  const msg = err?.message ?? String(err)
  if (/fetch|network|ENOTFOUND|ECONN|timeout/i.test(msg)) {
    console.error(`\n⚠️  OFFLINE: could not reach Pendle Hosted SDK API (${msg}).`)
  } else {
    console.error(`\n❌ ${msg}`)
  }
  process.exit(1)
})
