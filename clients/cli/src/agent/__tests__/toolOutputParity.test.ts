/**
 * Parity cross-check — the Phase-1 deliverable.
 *
 * Proves the client-side tool-output enrichment against the backend `tx_ready`
 * by canonicalizing BOTH into `{to,value,data,chain,chain_id,tx_encoding,amount,
 * memo}` leg tuples and diffing them. A safety-relevant divergence is surfaced
 * (so the session can log it LOUDLY); intentional client-side normalization
 * (to_address→to, calldata→data) must NOT be flagged; tx_ready-exclusive fields
 * (typed_confirm, sequence_id) are reported, not treated as divergence.
 */
import { describe, expect, it } from 'vitest'

import { canonicalizeForParity, diffToolOutputParity, payloadLooksSignable } from '../toolOutputSigning'

const TO = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
const ROUTER = '0x1111111111111111111111111111111111111111'
const DATA = '0x095ea7b3' + '0'.repeat(120)
const DATA2 = '0x095ea7b3' + '1'.repeat(120)

describe('diffToolOutputParity — matching payloads', () => {
  it('single-leg EVM: enriched {tx} == tx_ready {tx} → match, no divergences', () => {
    const enriched = { __buildTx: true, chain: 'Polygon', chain_id: '137', tx: { to: TO, value: '0', data: DATA } }
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to: TO, value: '0', data: DATA } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(true)
    expect(r.divergences).toEqual([])
  })

  it('divergent fields: enriched {to,data} canonically equals tx_ready {to_address,calldata} → match', () => {
    // The whole point of the family-B normalizer: the enriched candidate renames
    // to_address/calldata → to/data; the raw backend tx_ready wraps them verbatim.
    // Canonicalization reads BOTH conventions, so this is NOT a divergence.
    const enriched = { chain: 'Polygon', chain_id: '137', tx: { to: ROUTER, value: '0', data: DATA } }
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to_address: ROUTER, value: '0', calldata: DATA } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(true)
  })

  it('case-insensitive address/calldata comparison', () => {
    const enriched = {
      chain: 'Base',
      chain_id: '8453',
      tx: { to: TO.toUpperCase().replace('0X', '0x'), data: DATA.toUpperCase().replace('0X', '0x') },
    }
    const txReady = { chain: 'Base', chain_id: '8453', tx: { to: TO, data: DATA } }
    expect(diffToolOutputParity(enriched, txReady).match).toBe(true)
  })

  it('two-leg approve+main: enriched {approvalTxArgs,txArgs} == tx_ready → match', () => {
    const mk = () => ({
      chain: 'Polygon',
      chain_id: '137',
      approvalTxArgs: { chain: 'Polygon', chain_id: '137', tx: { to: TO, value: '0', data: DATA } },
      txArgs: { chain: 'Polygon', chain_id: '137', tx: { to: ROUTER, value: '0', data: DATA2 } },
    })
    const r = diffToolOutputParity(mk(), mk())
    expect(r.match).toBe(true)
    expect(canonicalizeForParity(mk())?.legs).toHaveLength(2)
  })

  it('non-EVM: enriched/tx_ready {txArgs:{to,amount,memo,tx_encoding}} equal → match', () => {
    const mk = () => ({
      chain: 'THORChain',
      txArgs: {
        chain: 'THORChain',
        tx_encoding: 'cosmos-msg',
        to: '',
        amount: '1000000',
        memo: '=:BTC.BTC:bc1qxyz::v0:10',
      },
    })
    expect(diffToolOutputParity(mk(), mk()).match).toBe(true)
  })

  it('execute_* prep single leg: tool-output prep == tx_ready prep (chain read from txArgs)', () => {
    const mk = () => ({
      txArgs: { chain: 'Base', chain_id: '8453', tx: { to: TO, value: '0', data: DATA } },
      stepperConfig: {},
    })
    const r = diffToolOutputParity(mk(), mk())
    expect(r.match).toBe(true)
    expect(canonicalizeForParity(mk())?.legs[0]).toMatchObject({ to: TO, chain: 'Base', chainId: '8453' })
  })

  it('equal gas_limit on both channels → match', () => {
    const mk = () => ({ chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA, gas_limit: '250000' } })
    expect(diffToolOutputParity(mk(), mk()).match).toBe(true)
  })

  it('reports tx_ready-exclusive fields (typed_confirm, sequence_id) without breaking match', () => {
    const enriched = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA } }
    const txReady = {
      chain: 'Polygon',
      chain_id: '137',
      tx: { to: TO, data: DATA },
      typed_confirm: true,
      sequence_id: 'seq-1',
    }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(true)
    expect(r.txReadyExclusive).toEqual(expect.arrayContaining(['typed_confirm', 'sequence_id']))
  })
})

describe('diffToolOutputParity — real divergences (logged LOUDLY by the session)', () => {
  it('flags a calldata divergence', () => {
    const enriched = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA } }
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA2 } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.startsWith('leg[0].data'))).toBe(true)
  })

  it('flags a CHAIN divergence (wrong-chain routing is the catastrophic case)', () => {
    const enriched = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA } }
    const txReady = { chain: 'Ethereum', chain_id: '1', tx: { to: TO, data: DATA } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.includes('chain'))).toBe(true)
  })

  it('flags a leg-count divergence (multi-leg vs single)', () => {
    const single = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA } }
    const multi = {
      chain: 'Polygon',
      chain_id: '137',
      approvalTxArgs: { tx: { to: TO, data: DATA } },
      txArgs: { tx: { to: ROUTER, data: DATA2 } },
    }
    const r = diffToolOutputParity(single, multi)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.includes('leg count'))).toBe(true)
  })

  it('flags a gas_limit divergence — it changes the signed EVM gasLimit, not advisory', () => {
    const enriched = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA } }
    const txReady = { chain: 'Polygon', chain_id: '137', tx: { to: TO, data: DATA, gas_limit: '250000' } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.includes('gasLimit'))).toBe(true)
  })

  it('flags an amount divergence (non-EVM send value must match)', () => {
    const enriched = { txArgs: { tx_encoding: 'utxo-psbt', to: 'bc1qxyz', amount: '1000' } }
    const txReady = { txArgs: { tx_encoding: 'utxo-psbt', to: 'bc1qxyz', amount: '2000' } }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.includes('amount'))).toBe(true)
  })

  it('flags a non-EVM memo divergence (THOR/Maya routing must match)', () => {
    const enriched = {
      txArgs: { tx_encoding: 'cosmos-msg', to: '', amount: '1000000', memo: '=:BTC.BTC:bc1qAAA::v0:10' },
    }
    const txReady = {
      txArgs: { tx_encoding: 'cosmos-msg', to: '', amount: '1000000', memo: '=:BTC.BTC:bc1qBBB::v0:10' },
    }
    const r = diffToolOutputParity(enriched, txReady)
    expect(r.match).toBe(false)
    expect(r.divergences.some(d => d.includes('memo'))).toBe(true)
  })
})

describe('payloadLooksSignable — selection guard mirrors the executor', () => {
  it('single-leg EVM with a real to → signable', () => {
    expect(payloadLooksSignable({ chain: 'Polygon', tx: { to: TO, data: DATA } })).toBe(true)
  })

  it('prep envelope with txArgs.tx.to → signable', () => {
    expect(payloadLooksSignable({ txArgs: { chain: 'Base', tx: { to: TO, data: DATA } } })).toBe(true)
  })

  it('build_custom_* backend tx_ready wrapping to_address/calldata → NOT signable (falls back to tool-output)', () => {
    expect(payloadLooksSignable({ chain: 'Polygon', tx: { to_address: ROUTER, calldata: DATA } })).toBe(false)
  })

  it('non-EVM txArgs with to + amount → signable', () => {
    expect(
      payloadLooksSignable({ txArgs: { chain: 'Bitcoin', tx_encoding: 'utxo-psbt', to: 'bc1qxyz', amount: '1000' } })
    ).toBe(true)
  })

  it('two-leg needs both legs signable', () => {
    expect(
      payloadLooksSignable({
        approvalTxArgs: { tx: { to: TO, data: DATA } },
        txArgs: { tx: { to: ROUTER, data: DATA2 } },
      })
    ).toBe(true)
    // main leg missing a real `to` → not signable
    expect(
      payloadLooksSignable({ approvalTxArgs: { tx: { to: TO, data: DATA } }, txArgs: { tx: { data: DATA2 } } })
    ).toBe(false)
  })

  it('null / non-object → not signable', () => {
    expect(payloadLooksSignable(null)).toBe(false)
    expect(payloadLooksSignable('nope')).toBe(false)
  })
})
