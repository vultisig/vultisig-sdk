#!/usr/bin/env node
// Runnable receipt for sdk.gas.utxoFeeRate (UTXO sat/vB).
//
// Exercises the REAL SDK source (packages/sdk/src/tools/gas/utxoFeeRate.ts)
// against the live THORChain / MayaChain inbound_addresses sources — this is
// the curl-equivalent: it prints actual on-chain recommended fee rates.
//
// Run from the SDK repo root:
//   node --import tsx scripts/receipts/gas_utxo_feerate.mjs
//
// (the `--import tsx` flag lets this .mjs import the TypeScript primitive
//  directly so the receipt proves the shipped code path, not a copy.)

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const srcPath = resolve(here, '../../packages/sdk/src/tools/gas/utxoFeeRate.ts')

const { utxoFeeRate } = await import(srcPath)

const chains = ['Bitcoin', 'Litecoin', 'Dogecoin', 'Bitcoin-Cash', 'Dash', 'Zcash']

console.log('sdk.gas.utxoFeeRate — live UTXO fee rates (sat/vB)\n')

for (const chain of chains) {
  try {
    const result = await utxoFeeRate(chain)
    console.log(
      `  ${chain.padEnd(13)} ${String(result.feeRate).padStart(5)} ${result.feeRateUnit}`,
    )
  } catch (err) {
    // Halted / source-down is a legitimate, honest result (the primitive
    // refuses to emit a zero-fee envelope) — surface it, don't swallow.
    console.log(`  ${chain.padEnd(13)}   ERR  ${err instanceof Error ? err.message : String(err)}`)
  }
}

console.log('\nReceipt OK')
