#!/usr/bin/env -S node --experimental-strip-types
/**
 * Runnable receipt for sdk.swap.jupiter (buildJupiterSwapTx).
 *
 * Fetches a LIVE Jupiter quote SOL → USDC and builds the UNSIGNED swap tx,
 * then prints the route + out amount + a snippet of the base64 unsigned
 * VersionedTransaction. NO signing, NO broadcast.
 *
 * Run:  node_modules/.bin/tsx scripts/receipts/swap_jupiter.mjs
 *
 * Uses the public Jupiter Lite API (no key needed) so the receipt is
 * reproducible outside the Vultisig proxy. The SDK default base URL is the
 * Vultisig proxy; we override it here purely for a key-free public receipt.
 */
import { buildJupiterSwapTx, SOL_NATIVE_MINT } from '../../packages/sdk/src/tools/swap/jupiter.ts'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
// Well-known Solana account (any valid base58 pubkey works for an unsigned build).
const USER = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'
const AMOUNT_LAMPORTS = 100_000_000n // 0.1 SOL

const res = await buildJupiterSwapTx({
  userPublicKey: USER,
  // omit fromContractAddress => native SOL
  toContractAddress: USDC_MINT,
  amountBaseUnits: AMOUNT_LAMPORTS,
  apiBaseUrl: 'https://lite-api.jup.ag',
})

const usdc = (Number(res.outAmount) / 1e6).toFixed(6)
const minUsdc = (Number(res.minOutAmount) / 1e6).toFixed(6)

console.log('=== sdk.swap.jupiter — LIVE Jupiter quote (SOL → USDC) ===')
console.log(`input        : 0.1 SOL (${SOL_NATIVE_MINT})`)
console.log(`output mint  : USDC (${res.outputMint})`)
console.log(`route        : ${res.routeLabels.join(' -> ')}`)
console.log(`out amount   : ${res.outAmount} base units  (~${usdc} USDC)`)
console.log(`min out      : ${res.minOutAmount} base units  (~${minUsdc} USDC, 1% slippage)`)
console.log(`price impact : ${res.priceImpactPct}`)
console.log(`affiliate fee: ${res.affiliateFeeApplied ? 'ON' : 'OFF (no treasury ATA configured)'}`)
console.log(`unsigned tx  : ${res.swapTransaction.slice(0, 48)}... (${res.swapTransaction.length} b64 chars)`)

// Receipt assertions — fail loudly if the contract is broken.
if (!res.swapTransaction || res.swapTransaction.length < 100) {
  throw new Error('receipt FAILED: empty/short unsigned tx')
}
if (BigInt(res.outAmount) <= 0n) {
  throw new Error('receipt FAILED: non-positive out amount')
}
console.log('\nRECEIPT OK: live unsigned Solana swap tx built (never signed, never broadcast).')
