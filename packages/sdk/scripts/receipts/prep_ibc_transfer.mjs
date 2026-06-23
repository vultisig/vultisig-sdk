/**
 * Runnable receipt for `sdk.prep.ibcTransfer` (prepareIbcTransfer).
 *
 * Builds an UNSIGNED ICS-20 MsgTransfer with throwaway inputs and prints its
 * structure. PURE CRYPTO — this never signs, never broadcasts, never hits the
 * network. The vault's signing material is never touched.
 *
 * Run:
 *   node --import tsx packages/sdk/scripts/receipts/prep_ibc_transfer.mjs
 * (from the SDK package dir, the relative import resolves to ../../src.)
 */
import { bech32 } from '@scure/base'

import { prepareIbcTransfer, supportedIbcDestinationsFrom } from '../../src/tools/prep/ibcTransfer.ts'

// ── throwaway inputs (valid bech32 checksums, NOT funded, NOT real) ───────────
const tossAddr = (hrp, fill) =>
  bech32.encode(hrp, bech32.toWords(new Uint8Array(20).fill(fill)), false)

const fromAddress = tossAddr('osmo', 0x11)
const toAddress = tossAddr('cosmos', 0x22)

// Deterministic clock so the printed timeout_timestamp is reproducible.
const nowMs = 1782604800000 // 2026-07-01T00:00:00Z

const built = prepareIbcTransfer({
  fromChain: 'osmosis-1',
  toChainId: 'cosmoshub-4', // channel reverse-resolved from the route table
  fromAddress,
  toAddress,
  denom: 'uosmo',
  amount: '1000000', // 1 OSMO in base units (uosmo, 1e-6)
  // accountNumber / sequence intentionally omitted — caller (signing client)
  // supplies them; the builder does NOT reach the network.
  nowMs,
})

console.log('=== sdk.prep.ibcTransfer — UNSIGNED ICS-20 MsgTransfer (OSMO → cosmoshub-4) ===\n')
console.log('route:           ', built.routeDescription)
console.log('source channel:  ', built.sourceChannel, '(reverse-resolved from toChainId=cosmoshub-4)')
console.log('msg type url:    ', built.msgTypeUrl)
console.log('\n--- inner MsgTransfer ---')
console.log(JSON.stringify(built.msgTransfer, null, 2))
console.log('\n--- unsigned cosmos_tx envelope (what the signing client consumes) ---')
console.log(JSON.stringify(built.cosmosTx, null, 2))
console.log('\n--- supported destinations FROM osmosis-1 ---')
console.log(supportedIbcDestinationsFrom('osmosis-1').join(', '))

// Sanity asserts so a regression makes the receipt exit non-zero.
const inner = JSON.parse(built.cosmosTx.msgs[0].msg)
const ok =
  built.sourceChannel === 'channel-0' &&
  built.destChain === 'cosmoshub-4' &&
  built.msgTypeUrl === '/ibc.applications.transfer.v1.MsgTransfer' &&
  inner.source_port === 'transfer' &&
  inner.token.denom === 'uosmo' &&
  inner.token.amount === '1000000' &&
  built.cosmosTx.account_number === undefined // never fabricated
if (!ok) {
  console.error('\nRECEIPT FAILED: built tx did not match expected shape')
  process.exit(1)
}
console.log('\nOK — unsigned tx built, not signed, not broadcast.')
