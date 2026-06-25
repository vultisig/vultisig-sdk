#!/usr/bin/env node
/**
 * Runnable receipt for sdk.swap.across (Across bridge quote).
 *
 * Fetches a LIVE, read-only Across `suggested-fees` quote for a real route
 * (USDC Base → USDC Arbitrum by default) and prints the verified output amount
 * + fees. Quote-only: never builds calldata, signs, or broadcasts.
 *
 * The acrossQuote primitive only depends on `viem`, so this runs cleanly under
 * tsx without any WASM/MPC bootstrap.
 *
 * Usage:
 *   yarn workspace @vultisig/sdk dlx tsx scripts/receipts/swap_across.mjs
 *   # or from the sdk package dir:
 *   node --import tsx scripts/receipts/swap_across.mjs
 */
import { acrossQuote } from '../../src/tools/swap/acrossQuote.ts'

// USDC on Base → USDC on Arbitrum, 1 USDC (6 decimals).
// NOTE: the SDK pins the origin to Ethereum for the current factory slice, so
// the live receipt uses Ethereum → Arbitrum to exercise a real, supported route.
const route = {
  sourceChain: 'Ethereum',
  destinationChain: 'Arbitrum',
  inputToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
  outputToken: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC on Arbitrum
  amount: '1000000', // 1 USDC
}

const main = async () => {
  console.log('sdk.swap.across — live Across bridge quote (read-only)')
  console.log(
    `route: ${route.sourceChain} → ${route.destinationChain}, ` +
      `${Number(route.amount) / 1e6} USDC`,
  )

  const quote = await acrossQuote(route)

  const out = Number(BigInt(quote.outputAmount)) / 1e6
  const relayFee = quote.fees.relayFeeTotal ? Number(BigInt(quote.fees.relayFeeTotal)) / 1e6 : undefined
  const lpFee = quote.fees.lpFeeTotal ? Number(BigInt(quote.fees.lpFeeTotal)) / 1e6 : undefined

  console.log('')
  console.log(`provider:                ${quote.provider}`)
  console.log(`action:                  ${quote.action}`)
  console.log(`execution_status:        ${quote.executionStatus}`)
  console.log(`source_chain_id:         ${quote.sourceChainId}`)
  console.log(`destination_chain_id:    ${quote.destinationChainId}`)
  console.log(`input_amount:            ${quote.inputAmount} (1 USDC)`)
  console.log(`output_amount:           ${quote.outputAmount} (${out} USDC)`)
  console.log(`relay_fee_total:         ${quote.fees.relayFeeTotal ?? 'n/a'}${relayFee !== undefined ? ` (${relayFee} USDC)` : ''}`)
  console.log(`lp_fee_total:            ${quote.fees.lpFeeTotal ?? 'n/a'}${lpFee !== undefined ? ` (${lpFee} USDC)` : ''}`)
  console.log(`estimated_fill_time_sec: ${quote.estimatedFillTimeSec ?? 'n/a'}`)
  console.log(`source_spoke_pool:       ${quote.spokePoolAddress} (pinned + verified)`)
  console.log(`dest_spoke_pool:         ${quote.destinationSpokePoolAddress} (pinned + verified)`)
  console.log(`quote_id:                ${quote.quoteId ?? 'n/a'}`)
  console.log('')
  console.log('OK — live quote fetched, SpokePools verified, no broadcast.')

  // Fund-safety guard: a burn/dead recipient must be rejected BEFORE any
  // network call (ported from the mcp-ts `across.ts` source contract).
  console.log('')
  console.log('burn-guard check (recipient = 0xdead…942069):')
  try {
    await acrossQuote({ ...route, to: '0xdead000000000000000042069420694206942069' })
    console.error('BURN GUARD FAILED: a burn recipient was NOT rejected')
    process.exit(1)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (!/Refusing to build transaction/.test(msg)) {
      console.error('BURN GUARD FAILED: unexpected error', msg)
      process.exit(1)
    }
    console.log(`  rejected as expected → ${msg}`)
  }
  console.log('')
  console.log('OK — burn-address recipient rejected pre-flight.')
}

main().catch(err => {
  console.error('RECEIPT FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
