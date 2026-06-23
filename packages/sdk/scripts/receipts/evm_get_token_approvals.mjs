#!/usr/bin/env node
/**
 * Runnable receipt for sdk.evm.getTokenApprovals.
 *
 * Hits a LIVE Ethereum RPC: enumerates active ERC-20 approvals for an address
 * known to hold approvals, then prints spender + allowance per token.
 *
 * Run (from packages/sdk):
 *   yarn node --import tsx scripts/receipts/evm_get_token_approvals.mjs
 *   # or: node --import tsx scripts/receipts/evm_get_token_approvals.mjs [address] [chain]
 */
import { getTokenApprovals } from '../../src/tools/evm/getTokenApprovals.ts'

// Default: vitalik.eth — a long-lived address with many active mainnet approvals.
const owner = process.argv[2] ?? '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const chain = process.argv[3] ?? 'Ethereum'

const fmt = (a) => (a.isUnlimited ? 'unlimited' : a.allowance.toString())

const main = async () => {
  console.log(`> sdk.evm.getTokenApprovals("${chain}", { owner: "${owner}" })\n`)
  const t0 = Date.now()
  const result = await getTokenApprovals(chain, { owner })
  const ms = Date.now() - t0

  console.log(`owner:       ${result.address}`)
  console.log(`chain:       ${result.chain}`)
  console.log(`totalCount:  ${result.totalCount}`)
  console.log(`elapsed:     ${ms}ms\n`)

  const shown = result.approvals.slice(0, 15)
  for (const a of shown) {
    const sym = (a.tokenSymbol ?? '?').padEnd(10)
    console.log(`  ${sym} token=${a.tokenAddress} spender=${a.spenderAddress} allowance=${fmt(a)}`)
  }
  if (result.approvals.length > shown.length) {
    console.log(`  ... and ${result.approvals.length - shown.length} more`)
  }

  if (result.totalCount === 0) {
    console.log('\n(no active approvals — address may have revoked all, or RPC returned no logs)')
  }
}

main().catch((err) => {
  console.error('receipt failed:', err)
  process.exit(1)
})
