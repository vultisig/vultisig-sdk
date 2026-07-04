#!/usr/bin/env node
/**
 * Runnable receipt for `sdk.gas.compareCosts(chains)`.
 *
 * Fans out the live `eth_gasPrice` read across Ethereum / Base / Arbitrum and
 * prints the gwei per chain plus the cheapest, ranked by estimated native tx
 * cost. Hits real public RPC endpoints — no mocks.
 *
 *   node scripts/receipts/gas_compare_costs.mjs
 *
 * tsx is registered programmatically so the TS source can be imported directly
 * (the SDK dist is not required to be built for the receipt).
 */
import { register } from 'tsx/esm/api'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
register()

const { compareCosts } = await import(
  resolve(__dirname, '../../src/tools/gas/compareCosts.ts')
)

const chains = ['Ethereum', 'Base', 'Arbitrum']
const res = await compareCosts({ chains, txType: 'transfer' })

console.log(`compareCosts(${JSON.stringify(chains)}) — txType=${res.txType}, gasUnits=${res.gasUnits}`)
console.log('')
for (const r of res.results) {
  console.log(
    `  ${r.chain.padEnd(10)} ${String(r.gasPriceGwei).padStart(10)} gwei` +
      `   est tx cost: ${r.estTxCostNative.toExponential(3)} native`
  )
}
if (res.skipped.length > 0) {
  for (const s of res.skipped) console.log(`  ${s.chain.padEnd(10)} SKIPPED: ${s.error}`)
}
console.log('')
console.log(`  cheapest → ${res.cheapest?.chain} (${res.cheapest?.estTxCostNative.toExponential(3)} native)`)
