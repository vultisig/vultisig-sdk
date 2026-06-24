#!/usr/bin/env node
// Runnable receipt for sdk.balance.cosmos (getCosmosBalance).
//
// Hits LIVE Osmosis + Cosmos Hub LCDs for a known, funded osmosis/cosmos
// address and prints the decoded bank-denom balances — native OSMO/ATOM plus
// IBC vouchers, decimal-scaled where the symbol+decimals resolve.
//
// Read-only: no signing, no broadcast. Live RPC.
//
//   npx tsx scripts/receipts/balance_cosmos.mjs   (from packages/sdk)
//
// Run from packages/sdk so the source tsconfig path aliases resolve.

import { getCosmosBalance } from '../../packages/sdk/src/tools/balance/cosmos.ts'
import { Chain } from '@vultisig/core-chain/Chain'

// Known long-lived addresses with non-trivial holdings (incl. IBC vouchers).
// Osmosis Foundation grants multisig + a well-known Cosmos Hub address.
const TARGETS = [
  { chain: Chain.Osmosis, address: 'osmo1cyyzpxplxdzkeea7kwsydadg87357qnahakaks' },
  { chain: Chain.Cosmos, address: 'cosmos1cyyzpxplxdzkeea7kwsydadg87357qnalx9dqz' },
]

function summarize(entry) {
  const dec = entry.decimals === null ? 'null' : entry.decimals
  return `  ${entry.symbol.padEnd(28)} amount=${String(entry.amount).padEnd(22)} formatted=${String(entry.formatted ?? '-').padEnd(18)} decimals=${dec}${entry.unresolved ? ' (unresolved)' : ''}`
}

for (const { chain, address } of TARGETS) {
  console.log(`\n=== ${chain} :: ${address} ===`)
  try {
    const res = await getCosmosBalance(chain, address)
    console.log(`native: ${res.nativeFormatted} ${res.nativeTicker}  (raw ${res.nativeRaw})`)
    console.log(`as_of:  ${res.asOf}`)
    console.log(`denoms held (${res.balances.length}):`)
    for (const entry of res.balances.slice(0, 12)) {
      console.log(summarize(entry))
    }
    if (res.balances.length > 12) {
      console.log(`  ... +${res.balances.length - 12} more`)
    }
    const resolved = res.balances.filter(b => b.decimals != null).length
    const unresolved = res.balances.filter(b => b.unresolved).length
    console.log(`resolved=${resolved}  unresolved(base-units)=${unresolved}`)
  } catch (err) {
    console.error(`FAILED: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
  }
}
