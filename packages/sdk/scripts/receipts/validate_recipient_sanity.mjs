#!/usr/bin/env node
/**
 * Runnable receipt for sdk.validate.recipientSanity (pure recipient sanity).
 *
 * Exercises the three deterministic checks ported from the agent-backend
 * validators (null_recipient / self_send_warning / malformed_evm_recipient)
 * against REAL inputs and prints each result. No vault, no RPC, no broadcast —
 * these are pure format / equality checks.
 *
 * Run from packages/sdk:
 *   node --import tsx scripts/receipts/validate_recipient_sanity.mjs
 */

import { recipientSanity } from '../../src/tools/validate/recipientSanity.ts'

const cases = [
  {
    label: 'null recipient (EVM zero address)',
    input: { recipient: '0x0000000000000000000000000000000000000000' },
    expect: 'null',
  },
  {
    label: 'null recipient (EVM 0x...dEaD burn)',
    input: { recipient: '0x000000000000000000000000000000000000dEaD' },
    expect: 'null',
  },
  {
    label: 'null recipient (Solana System Program)',
    input: { recipient: '11111111111111111111111111111111' },
    expect: 'null',
  },
  {
    label: 'self-send (from === recipient, case-insensitive)',
    input: {
      from: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      recipient: '0x742d35cc6634c0532925a3b844bc454e4438f44e',
    },
    expect: 'selfSend',
  },
  {
    label: 'malformed EVM recipient (0xdeadbeef — too short)',
    input: { recipient: '0xdeadbeef' },
    expect: 'malformedEvm',
  },
  {
    label: 'clean valid distinct recipient (control — no flags)',
    input: {
      from: '0x0000000000000000000000000000000000000000',
      recipient: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    },
    expect: null,
  },
]

let failures = 0
console.log('=== sdk.validate.recipientSanity — runnable receipt ===\n')

for (const c of cases) {
  const result = recipientSanity(c.input)
  const fired = result.flags.length ? result.flags.join('+') : '(clean)'
  const ok = c.expect === null ? !result.flagged : result.flags.includes(c.expect)
  if (!ok) failures += 1
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${c.label}`)
  console.log(`        in:    ${JSON.stringify(c.input)}`)
  console.log(`        flags: ${fired}`)
  console.log(`        full:  ${JSON.stringify(result)}\n`)
}

console.log(`=== ${cases.length - failures}/${cases.length} cases as expected ===`)
process.exit(failures === 0 ? 0 : 1)
