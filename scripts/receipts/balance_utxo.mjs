#!/usr/bin/env node
// Runnable receipt for sdk.balance.utxo (getUtxoBalance).
// Fetches a REAL BTC balance via the SDK primitive (Blockchair) and
// cross-checks the satoshi figure against a second independent source
// (blockchain.info) so the number is provably correct, not fabricated.
//
// Usage: node --import tsx scripts/receipts/balance_utxo.mjs [address]
//
// Imports the SDK source directly through the workspace tsx loader so the
// receipt exercises the exact exported primitive (no dist build required).
// tsx is registered via the `--import tsx` flag (see usage above).

import { fileURLToPath } from 'node:url'

const srcUrl = new URL('../../packages/sdk/src/tools/balance/utxoBalance.ts', import.meta.url)
const { getUtxoBalance } = await import(fileURLToPath(srcUrl))

// Bitcoin genesis (coinbase) address — permanently non-zero, well-known.
const address = process.argv[2] ?? '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'

console.log(`[receipt] sdk.balance.utxo — Bitcoin ${address}\n`)

// 1) SDK primitive (Blockchair under the hood)
const sdkResult = await getUtxoBalance('Bitcoin', address)
console.log('[source A] SDK getUtxoBalance (Blockchair):')
console.log(JSON.stringify(sdkResult, null, 2))

// 2) Independent cross-check — blockchain.info final_balance (satoshis)
const xcheckUrl = `https://blockchain.info/q/addressbalance/${address}`
const xcheckRes = await fetch(xcheckUrl, { signal: AbortSignal.timeout(30_000) })
const xcheckSats = (await xcheckRes.text()).trim()
console.log(`\n[source B] blockchain.info addressbalance (satoshis): ${xcheckSats}`)

// 3) Reconcile
const match = sdkResult.satoshis === xcheckSats
console.log(`\n[cross-check] Blockchair sats=${sdkResult.satoshis}  blockchain.info sats=${xcheckSats}  →  ${match ? 'MATCH ✓' : 'MISMATCH ✗'}`)
console.log(`[human]       ${sdkResult.balance} ${sdkResult.symbol}`)

if (!match) {
  console.error('\n[receipt] sources disagree — balance may have changed mid-fetch or an API is stale.')
  process.exit(1)
}
console.log('\n[receipt] OK — two independent sources agree.')
