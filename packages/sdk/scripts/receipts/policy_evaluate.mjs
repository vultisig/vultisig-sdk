/**
 * Runnable receipt for sdk.policy.evaluate(claim, envelope) -> Verdict.
 *
 * PURE comparison only — no network, no vault, no signing, no broadcast. Imports
 * the policy module source directly (tsx transpiles on the fly) so the receipt
 * exercises the real ported logic without a full SDK build.
 *
 * Run:  yarn dlx tsx scripts/receipts/policy_evaluate.mjs
 *   or  ../../node_modules/.bin/tsx scripts/receipts/policy_evaluate.mjs
 */

import { policy } from '../../src/tools/policy/index.ts'

const line = (s) => process.stdout.write(s + '\n')

line('=== sdk.policy.evaluate(claim, envelope) -> Verdict ===\n')

// ── Case 1: recipient mismatch — send 1 USDC to 0xAAA, envelope pays 0xBBB ──
const claimMismatch = {
  chain: 'base',
  recipient: '0xAAA',
  asset: 'USDC',
  amount: '1',
  amountUnits: 'human',
}
const envMismatch = {
  decoded: true,
  chainId: 'base',
  recipient: '0xBBB',
  asset: { symbol: 'USDC', decimals: 6 },
  amount: 1_000_000n, // 1 USDC in base units (6 dp)
}
const v1 = policy.evaluate(claimMismatch, envMismatch)
line('[1] MISMATCH  claim {send 1 USDC -> 0xAAA}  vs  envelope {0xBBB, 1 USDC}')
line('    result : ' + v1.result)
line('    reason : ' + v1.reason)
line('    diff   : ' + JSON.stringify(v1.diff))
line('')

// ── Case 2: matching pair — same recipient/amount/asset/chain → clean PASS ──
const claimMatch = {
  chain: 'base',
  recipient: '0xAAA',
  asset: 'USDC',
  amount: '1',
  amountUnits: 'human',
}
const envMatch = {
  decoded: true,
  chainId: 'base',
  recipient: '0xAAA',
  asset: { symbol: 'USDC', decimals: 6 },
  amount: 1_000_000n,
}
const v2 = policy.evaluate(claimMatch, envMatch)
line('[2] MATCH     claim {send 1 USDC -> 0xAAA}  vs  envelope {0xAAA, 1 USDC}')
line('    result : ' + v2.result)
line('    reason : ' + v2.reason)
line('    diff   : ' + JSON.stringify(v2.diff))
line('')

// ── Case 3: amount drift > 1% — claim 1 USDC, envelope sends 2 USDC → BLOCK ──
const v3 = policy.evaluate(claimMatch, { ...envMatch, amount: 2_000_000n })
line('[3] DRIFT     claim {send 1 USDC -> 0xAAA}  vs  envelope {0xAAA, 2 USDC}')
line('    result : ' + v3.result)
line('    reason : ' + v3.reason)
line('')

// ── checkInvariants: every independent violation (I1 recipient + I3 chain) ──
const violations = policy.checkInvariants({
  claim: { chain: 'ethereum', recipient: '0xAAA', amount: '1', amountUnits: 'human' },
  envelope: {
    decoded: true,
    chainId: 'base',
    recipient: '0xBBB',
    asset: { symbol: 'USDC', decimals: 6 },
    amount: 1_000_000n,
  },
})
line('[4] INVARIANTS  claim {1 USDC -> 0xAAA on ethereum}  vs  envelope {0xBBB, base}')
line('    violations : ' + violations.map((x) => x.invariant).join(', '))
line('')

// ── assertions so the receipt is self-verifying (exit non-zero on regression) ──
const assert = (cond, msg) => {
  if (!cond) {
    line('ASSERT FAILED: ' + msg)
    process.exit(1)
  }
}
assert(v1.result === 'BLOCK', 'case 1 must BLOCK on recipient mismatch')
assert(v1.diff[0]?.field === 'recipient', 'case 1 diff must flag recipient')
assert(v2.result === 'PASS', 'case 2 must PASS')
assert(v2.diff.length === 0, 'case 2 must have no diff')
assert(v3.result === 'BLOCK', 'case 3 must BLOCK on amount drift')
assert(violations.some((x) => x.invariant === 'I1_recipient_matches_intent'), 'I1 must fire')
assert(violations.some((x) => x.invariant === 'I3_chain_matches_intent'), 'I3 must fire')

line('OK — all receipt assertions passed (PURE comparison, no signing/broadcast).')
