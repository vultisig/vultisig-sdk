import { describe, expect, it } from 'vitest'

import {
  buildThorchainLpAddPayload,
  buildThorchainLpRemovePayload,
} from './payload'

describe('buildThorchainLpAddPayload', () => {
  it('produces a flat pure-asym payload when no pairedAddress is provided', () => {
    const payload = buildThorchainLpAddPayload({
      pool: 'BTC.BTC',
      amountRuneBaseUnits: '1000000',
    })
    expect(payload).toEqual({
      kind: 'thorchain_lp_add',
      chain: 'THORChain',
      denom: 'rune',
      amount: '1000000',
      memo: '+:BTC.BTC',
      pool: 'BTC.BTC',
    })
  })

  it('produces a paired payload when pairedAddress is provided', () => {
    const payload = buildThorchainLpAddPayload({
      pool: 'BTC.BTC',
      amountRuneBaseUnits: '1000000',
      pairedAddress: 'bc1qaddress',
    })
    expect(payload).toEqual({
      kind: 'thorchain_lp_add',
      chain: 'THORChain',
      denom: 'rune',
      amount: '1000000',
      memo: '+:BTC.BTC:bc1qaddress',
      pool: 'BTC.BTC',
      pairedAddress: 'bc1qaddress',
    })
  })

  it('keeps the payload single-nesting-level (no nested objects)', () => {
    const payload = buildThorchainLpAddPayload({
      pool: 'ETH.ETH',
      amountRuneBaseUnits: '50000000',
      pairedAddress: '0xabc',
    })
    for (const value of Object.values(payload)) {
      expect(typeof value).not.toBe('object')
    }
  })

  it('omits the pairedAddress field entirely when not set (not just undefined)', () => {
    const payload = buildThorchainLpAddPayload({
      pool: 'BTC.BTC',
      amountRuneBaseUnits: '1000000',
    })
    expect('pairedAddress' in payload).toBe(false)
  })

  it('never includes affiliate fields', () => {
    const payload = buildThorchainLpAddPayload({
      pool: 'BTC.BTC',
      amountRuneBaseUnits: '1000000',
    })
    expect('affiliate' in payload).toBe(false)
    expect('affiliateBps' in payload).toBe(false)
  })

  it.each(['0', '-1', '1.5', '', 'abc'])(
    'rejects invalid amountRuneBaseUnits (%s)',
    amount => {
      expect(() =>
        buildThorchainLpAddPayload({
          pool: 'BTC.BTC',
          amountRuneBaseUnits: amount,
        })
      ).toThrow(/amountRuneBaseUnits/)
    }
  )
})

describe('buildThorchainLpRemovePayload', () => {
  it('produces a flat payload with the dust amount and bps memo', () => {
    const payload = buildThorchainLpRemovePayload({
      pool: 'BTC.BTC',
      basisPoints: 10000,
    })
    expect(payload).toEqual({
      kind: 'thorchain_lp_remove',
      chain: 'THORChain',
      denom: 'rune',
      amount: '2000000',
      memo: '-:BTC.BTC:10000',
      pool: 'BTC.BTC',
      basisPoints: 10000,
    })
  })

  it('uses the dust amount regardless of bps for partial withdraws', () => {
    const partial = buildThorchainLpRemovePayload({
      pool: 'ETH.ETH',
      basisPoints: 2500,
    })
    expect(partial.amount).toBe('2000000')
    expect(partial.memo).toBe('-:ETH.ETH:2500')
  })

  it('supports withdrawToAsset for asym-out-from-sym', () => {
    const payload = buildThorchainLpRemovePayload({
      pool: 'BTC.BTC',
      basisPoints: 10000,
      withdrawToAsset: 'BTC',
    })
    expect(payload.memo).toBe('-:BTC.BTC:10000:BTC')
    expect(payload.withdrawToAsset).toBe('BTC')
  })

  it('omits withdrawToAsset when not set', () => {
    const payload = buildThorchainLpRemovePayload({
      pool: 'BTC.BTC',
      basisPoints: 10000,
    })
    expect('withdrawToAsset' in payload).toBe(false)
  })

  it('rejects out-of-range basis points via the underlying memo builder', () => {
    expect(() =>
      buildThorchainLpRemovePayload({ pool: 'BTC.BTC', basisPoints: 0 })
    ).toThrow(/basisPoints/)
  })
})
