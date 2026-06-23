import { describe, expect, it } from 'vitest'

import { normalizeTx, splitMultiTx, TxNormalizeError } from '../../../src/tx/normalize'

describe('normalizeTx', () => {
  it('wraps a flat build_* result under "tx" and lifts chain metadata', () => {
    const flat = {
      to: '0xrecipient',
      value: '0x0',
      data: '0xabc',
      chain: 'Ethereum',
      chain_id: '1',
    }
    const out = normalizeTx(flat)
    expect(out['tx']).toEqual(flat)
    // chain / chain_id lifted to outer level for downstream resolution
    expect(out.chain).toBe('Ethereum')
    expect(out.chain_id).toBe('1')
  })

  it('leaves a result that already nests swap_tx untouched (only enriches chain)', () => {
    const nested = { swap_tx: { to: '0xpool', data: '0xdead' } }
    const out = normalizeTx(nested, { from_chain: 'Ethereum', to_chain: 'THORChain' })
    expect(out['swap_tx']).toEqual({ to: '0xpool', data: '0xdead' })
    expect(out['tx']).toBeUndefined() // not double-wrapped
    expect(out.from_chain).toBe('Ethereum')
    expect(out.to_chain).toBe('THORChain')
  })

  it('falls from_chain back to chain when from_chain arg is absent', () => {
    const out = normalizeTx({ tx: { to: '0x1' } }, { chain: 'Polygon' })
    expect(out.from_chain).toBe('Polygon')
    expect(out.chain).toBe('Polygon')
  })

  it('does not overwrite chain fields already present in the payload', () => {
    const out = normalizeTx(
      { tx: { to: '0x1' }, chain: 'Bitcoin', from_chain: 'Bitcoin' },
      { chain: 'Ethereum', from_chain: 'Ethereum' }
    )
    expect(out.chain).toBe('Bitcoin')
    expect(out.from_chain).toBe('Bitcoin')
  })

  it('accepts a raw JSON string (the MCP tool result transport)', () => {
    const out = normalizeTx('{"to":"0x1","chain":"Ethereum"}')
    expect(out['tx']).toEqual({ to: '0x1', chain: 'Ethereum' })
    expect(out.chain).toBe('Ethereum')
  })

  it('passes execute_* prep envelopes through without wrapping when routable', () => {
    const prep = {
      txArgs: { tx_encoding: 'evm', to: '0xc' },
      stepperConfig: { steps: ['sign'] },
      chain: 'Ethereum',
    }
    const out = normalizeTx(prep)
    // not wrapped under tx — txArgs/tx_encoding preserved
    expect(out['tx']).toBeUndefined()
    expect((out['txArgs'] as Record<string, unknown>)['tx_encoding']).toBe('evm')
  })

  it('throws on an execute_* prep envelope missing tx_encoding (phantom card)', () => {
    const phantom = {
      txArgs: { to: '0xc' },
      stepperConfig: { steps: [] },
    }
    expect(() => normalizeTx(phantom)).toThrow(TxNormalizeError)
  })

  it('throws on malformed JSON and non-object input', () => {
    expect(() => normalizeTx('{not json')).toThrow(TxNormalizeError)
    expect(() => normalizeTx('[1,2,3]')).toThrow(TxNormalizeError)
    expect(() => normalizeTx('"a string"')).toThrow(TxNormalizeError)
  })

  it('returns a fresh object (no mutation of the input)', () => {
    const input = { to: '0x1', chain: 'Ethereum' }
    const out = normalizeTx(input)
    expect(out).not.toBe(input)
    expect(input).toEqual({ to: '0x1', chain: 'Ethereum' })
  })
})

describe('splitMultiTx', () => {
  it('splits an approve+swap into ordered [approval, swap] legs with metadata', () => {
    const buildResult = {
      needs_approval: true,
      approval_tx: { to: '0xtoken', data: '0x095ea7b3' },
      swap_tx: { to: '0xrouter', data: '0xfeed' },
      provider: 'thorchain',
      chain: 'Ethereum',
      from_symbol: 'USDC',
      to_symbol: 'ETH',
      from_address: '0xuser',
    }
    const legs = splitMultiTx(buildResult)
    expect(legs).toHaveLength(2)

    // leg 0 = approval, wrapped under tx, approval-first ordering
    expect(legs[0]['tx']).toEqual({ to: '0xtoken', data: '0x095ea7b3' })
    expect(legs[0]['swap_tx']).toBeUndefined()
    expect(legs[0].provider).toBe('thorchain')
    expect(legs[0].chain).toBe('Ethereum')
    expect(legs[0].from_symbol).toBe('USDC')

    // leg 1 = swap, wrapped under swap_tx, same metadata copied on
    expect(legs[1]['swap_tx']).toEqual({ to: '0xrouter', data: '0xfeed' })
    expect(legs[1]['tx']).toBeUndefined()
    expect(legs[1].to_symbol).toBe('ETH')
    expect(legs[1].from_address).toBe('0xuser')
  })

  it('does NOT split when needs_approval is false', () => {
    const buildResult = {
      needs_approval: false,
      approval_tx: { to: '0xtoken' },
      swap_tx: { to: '0xrouter', data: '0xfeed' },
      chain: 'Ethereum',
    }
    const legs = splitMultiTx(buildResult)
    expect(legs).toHaveLength(1)
    // single leg keeps its nested swap_tx (normalizeTx no-op)
    expect(legs[0]['swap_tx']).toEqual({ to: '0xrouter', data: '0xfeed' })
  })

  it('splits a generic transactions[] array, copying parent metadata onto each leg', () => {
    const buildResult = {
      transactions: [
        { to: '0xa', data: '0x1' },
        { to: '0xb', data: '0x2' },
      ],
      chain: 'Ethereum',
      provider: 'morpho',
    }
    const legs = splitMultiTx(buildResult)
    expect(legs).toHaveLength(2)
    expect(legs[0]['tx']).toEqual({ to: '0xa', data: '0x1' })
    expect(legs[1]['tx']).toEqual({ to: '0xb', data: '0x2' })
    for (const leg of legs) {
      expect(leg.chain).toBe('Ethereum')
      expect(leg.provider).toBe('morpho')
    }
  })

  it('wraps a single-element transactions[] (len-1 Morpho op) under tx', () => {
    const buildResult = {
      transactions: [{ to: '0xa', data: '0x1' }],
      chain: 'Ethereum',
    }
    const legs = splitMultiTx(buildResult)
    expect(legs).toHaveLength(1)
    expect(legs[0]['tx']).toEqual({ to: '0xa', data: '0x1' })
    expect(legs[0].chain).toBe('Ethereum')
  })

  it('returns a single normalized leg for a plain single-tx build result', () => {
    const legs = splitMultiTx({ to: '0x1', data: '0xabc', chain: 'Ethereum' })
    expect(legs).toHaveLength(1)
    expect(legs[0]['tx']).toEqual({ to: '0x1', data: '0xabc', chain: 'Ethereum' })
    expect(legs[0].chain).toBe('Ethereum')
  })

  it('accepts the raw JSON string transport', () => {
    const legs = splitMultiTx('{"needs_approval":true,"approval_tx":{"to":"0xt"},"swap_tx":{"to":"0xr"}}')
    expect(legs).toHaveLength(2)
    expect(legs[0]['tx']).toEqual({ to: '0xt' })
    expect(legs[1]['swap_tx']).toEqual({ to: '0xr' })
  })

  it('throws on a malformed JSON string', () => {
    expect(() => splitMultiTx('{broken')).toThrow(TxNormalizeError)
  })
})
