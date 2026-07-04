/**
 * Runnable receipt for `sdk.defi.glif` (GLIF x ICN — Base ICNT liquid staking).
 *
 * BUILDS an unsigned GLIF stake tx (+ a redeem tx) from sample inputs and prints
 * the decoded calldata. NO signing, NO broadcast, NO RPC.
 *
 * Run from the SDK package root (tsx is hoisted to the workspace root bin):
 *   ../../node_modules/.bin/tsx scripts/receipts/defi_glif.mjs
 */
import { decodeFunctionData, erc20Abi, formatUnits } from 'viem'

import {
  buildGlifRedeemSticnt,
  buildGlifStakeIcnt,
  GLIF_ICN_BASE_ADDRESSES,
  GLIF_ICN_TOKEN_DECIMALS,
  glifPoolWriteAbi,
} from '../../src/defi/glif/index.ts'

const FROM = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' // sample staker (no funds, never signed)
const AMOUNT = 25n * 10n ** BigInt(GLIF_ICN_TOKEN_DECIMALS) // 25 ICNT in base units

const human = v => formatUnits(v, GLIF_ICN_TOKEN_DECIMALS)

function decodeTx(tx) {
  const abi = tx.action === 'approve' ? erc20Abi : glifPoolWriteAbi
  const { functionName, args } = decodeFunctionData({ abi, data: tx.data })
  return {
    action: tx.action,
    to: tx.to,
    value: tx.value,
    selector: tx.data.slice(0, 10),
    decoded: `${functionName}(${args.map(a => (typeof a === 'bigint' ? a.toString() : a)).join(', ')})`,
  }
}

console.log('=== sdk.defi.glif receipt — GLIF x ICN (Base) ===')
console.log('pinned addresses:', GLIF_ICN_BASE_ADDRESSES)
console.log()

// ---- STAKE: 25 ICNT (fresh allowance => approve + deposit) ----
const stake = buildGlifStakeIcnt({ from: FROM, amount: AMOUNT })
console.log(`STAKE ${human(AMOUNT)} ICNT  from=${stake.from}`)
console.log('  action      :', stake.action)
console.log('  chain/chainId:', stake.chain, stake.chainId)
console.log('  receiver    :', stake.receiver, '(default = from, injectable)')
console.log('  approvalReq  :', stake.approvalRequired)
console.log('  txs         :')
for (const tx of stake.transactions) console.log('   ', JSON.stringify(decodeTx(tx)))
console.log()

// ---- STAKE with pre-existing allowance (deposit only) ----
const stakeNoApprove = buildGlifStakeIcnt({ from: FROM, amount: AMOUNT, currentAllowance: AMOUNT })
console.log(`STAKE (allowance pre-set) => ${stakeNoApprove.transactions.length} tx (deposit only)`)
console.log()

// ---- REDEEM: 10 stICNT ----
const REDEEM = 10n * 10n ** BigInt(GLIF_ICN_TOKEN_DECIMALS)
const redeem = buildGlifRedeemSticnt({ from: FROM, amount: REDEEM })
console.log(`REDEEM ${human(REDEEM)} stICNT  from=${redeem.from}`)
console.log('  action      :', redeem.action)
console.log('  txs         :')
for (const tx of redeem.transactions) console.log('   ', JSON.stringify(decodeTx(tx)))
console.log()

// ---- assertions so a non-zero exit signals a real regression ----
const assert = (cond, msg) => {
  if (!cond) {
    console.error('RECEIPT ASSERTION FAILED:', msg)
    process.exit(1)
  }
}
assert(stake.transactions.length === 2, 'fresh-allowance stake must be [approve, deposit]')
assert(stake.transactions[0].action === 'approve', 'first stake tx must be approve')
assert(stake.transactions[1].action === 'deposit', 'second stake tx must be deposit')
assert(stakeNoApprove.transactions.length === 1, 'pre-approved stake must be deposit-only')
assert(redeem.transactions.length === 1 && redeem.transactions[0].action === 'redeem', 'redeem must be single redeem tx')
assert(stake.transactions.every(t => t.value === '0'), 'no native value on ERC-20/4626 flows')

console.log('OK — unsigned GLIF stake + redeem calldata built & decoded (no broadcast).')
