#!/usr/bin/env node
/**
 * Runnable receipt for sdk.tx.normalize + sdk.tx.split.
 *
 * Exercises the pure tx-shape primitives on REAL build-result shapes:
 *   1. normalizeTx() on a flat build_evm_tx result (wrap under "tx" + lift chain)
 *   2. normalizeTx() on an execute_* prep envelope (passthrough, no double-nest)
 *   3. splitMultiTx() on a 2-leg approve+swap build_swap_tx result (ordered legs)
 *   4. splitMultiTx() on a generic transactions[] array (per-leg metadata copy)
 *
 * NO signing, NO broadcast — pure shape transforms. Run from repo root:
 *   node scripts/receipts/tx_normalize.mjs
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

import { tsImport } from 'tsx/esm/api'

const __dirname = dirname(fileURLToPath(import.meta.url))
const modPath = resolve(__dirname, '../../packages/sdk/src/tx/normalize.ts')
const { normalizeTx, splitMultiTx } = await tsImport(modPath, import.meta.url)

const j = v => JSON.stringify(v, null, 2)
const hr = t => console.log(`\n${'='.repeat(4)} ${t} ${'='.repeat(4)}`)

// ---------------------------------------------------------------------------
// 1. normalizeTx: flat build_evm_tx result -> wrapped canonical tx envelope
// ---------------------------------------------------------------------------
hr('1. normalizeTx(flat build_evm_tx result)')
const flatBuild = {
  to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  value: '0x0',
  data: '0xa9059cbb',
  gas: '0x5208',
  chain: 'Ethereum',
  chain_id: '1',
}
const normalized = normalizeTx(flatBuild, { chain: 'Ethereum' })
console.log('input :', j(flatBuild))
console.log('output:', j(normalized))
console.assert(normalized.tx?.data === '0xa9059cbb', 'tx wrapped')
console.assert(normalized.chain === 'Ethereum', 'chain lifted')
console.assert(normalized.from_chain === 'Ethereum', 'from_chain enriched from arg')

// ---------------------------------------------------------------------------
// 2. normalizeTx: execute_* prep envelope passes through untouched
// ---------------------------------------------------------------------------
hr('2. normalizeTx(execute_* prep envelope)')
const prepEnvelope = {
  txArgs: { tx_encoding: 'evm', to: '0xrouter', data: '0xdeadbeef' },
  stepperConfig: { steps: ['sign', 'broadcast'] },
  chain: 'Ethereum',
}
const prepOut = normalizeTx(prepEnvelope)
console.log('output:', j(prepOut))
console.assert(prepOut.tx === undefined, 'prep NOT double-wrapped under tx')
console.assert(prepOut.txArgs?.tx_encoding === 'evm', 'tx_encoding discriminator preserved')

// ---------------------------------------------------------------------------
// 3. splitMultiTx: approve + swap -> ordered [approval, swap] legs
// ---------------------------------------------------------------------------
hr('3. splitMultiTx(approve + swap build_swap_tx result)')
const swapBuild = {
  needs_approval: true,
  approval_tx: {
    to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    data: '0x095ea7b3', // approve(spender, amount)
  },
  swap_tx: {
    to: '0x111111125421cA6dc452d289314280a0f8842A65', // 1inch router
    data: '0x12aa3caf',
  },
  provider: 'oneinch',
  chain: 'Ethereum',
  from_symbol: 'USDC',
  to_symbol: 'ETH',
  from_address: '0xUSER',
}
const legs = splitMultiTx(swapBuild)
console.log(`split into ${legs.length} ordered legs:`)
legs.forEach((leg, i) => {
  const kind = leg.tx ? 'approval (tx)' : 'swap (swap_tx)'
  console.log(`  leg ${i} = ${kind}: ${j(leg)}`)
})
console.assert(legs.length === 2, 'two legs')
console.assert(legs[0].tx?.data === '0x095ea7b3', 'leg 0 = approval first')
console.assert(legs[1].swap_tx?.data === '0x12aa3caf', 'leg 1 = swap')
console.assert(legs[0].provider === 'oneinch' && legs[1].provider === 'oneinch', 'metadata copied to both legs')

// ---------------------------------------------------------------------------
// 4. splitMultiTx: generic transactions[] array -> per-leg envelopes
// ---------------------------------------------------------------------------
hr('4. splitMultiTx(generic transactions[] array)')
const multiBuild = {
  transactions: [
    { to: '0xmorpho', data: '0x0001' },
    { to: '0xmorpho', data: '0x0002' },
  ],
  chain: 'Base',
  provider: 'morpho',
}
const genericLegs = splitMultiTx(multiBuild)
console.log(`split into ${genericLegs.length} legs:`)
genericLegs.forEach((leg, i) => console.log(`  leg ${i}: ${j(leg)}`))
console.assert(genericLegs.length === 2, 'two generic legs')
console.assert(
  genericLegs.every(l => l.chain === 'Base' && l.provider === 'morpho'),
  'parent metadata on each leg'
)

console.log('\nAll receipt assertions passed. (pure shape transforms — no signing, no broadcast)')
