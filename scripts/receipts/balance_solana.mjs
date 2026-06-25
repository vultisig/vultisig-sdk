// Runnable receipt for sdk.balance.solana (native SOL + SPL).
//
// Hits LIVE Solana mainnet RPC (proxied via https://api.vultisig.com/solana/)
// and prints a real native SOL balance + a real SPL (USDC) token balance for a
// known mainnet address.
//
//   Run with tsx (imports the TS source directly):
//     npx tsx packages/sdk/scripts/receipts/balance_solana.mjs
//   or from repo root:
//     npx tsx scripts/receipts/balance_solana.mjs  (path-relative to this file)

import { getSolBalance, getSplTokenBalance } from '../../packages/sdk/src/tools/balance/solana.ts'

// A well-known, long-lived mainnet address (Solana Foundation delegated stake pool authority).
const ADDRESS = 'GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ'
// USDC mint on Solana mainnet.
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const sol = await getSolBalance(ADDRESS)
console.log('native SOL :', JSON.stringify(sol))

const usdc = await getSplTokenBalance(ADDRESS, USDC_MINT)
console.log('SPL  USDC  :', JSON.stringify(usdc))
