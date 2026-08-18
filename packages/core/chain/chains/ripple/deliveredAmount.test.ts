import { describe, expect, it } from 'vitest'

import { readRippleDeliveredAmount } from './deliveredAmount'

describe('readRippleDeliveredAmount', () => {
  it('reads native XRP drops from delivered_amount', () => {
    expect(readRippleDeliveredAmount({ delivered_amount: '1000000', TransactionResult: 'tesSUCCESS' })).toEqual({
      type: 'xrp',
      drops: 1_000_000n,
    })
  })

  it('reads the legacy DeliveredAmount alias when delivered_amount is absent', () => {
    expect(readRippleDeliveredAmount({ DeliveredAmount: '42' })).toEqual({
      type: 'xrp',
      drops: 42n,
    })
  })

  it('prefers delivered_amount over the legacy alias', () => {
    expect(
      readRippleDeliveredAmount({
        delivered_amount: '1',
        DeliveredAmount: '999',
      })
    ).toEqual({ type: 'xrp', drops: 1n })
  })

  it('reads an issued-currency delivered_amount object', () => {
    expect(
      readRippleDeliveredAmount({
        delivered_amount: {
          currency: 'USD',
          issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
          value: '8.5',
        },
      })
    ).toEqual({
      type: 'issued',
      currency: 'USD',
      issuer: 'rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B',
      value: '8.5',
    })
  })

  it('never falls back to Amount when delivered_amount is missing', () => {
    expect(readRippleDeliveredAmount({ Amount: '999999999', TransactionResult: 'tesSUCCESS' })).toBeNull()
    expect(readRippleDeliveredAmount({ amount: '999999999' })).toBeNull()
  })

  it('never falls back to Amount when delivered_amount is present but malformed', () => {
    expect(
      readRippleDeliveredAmount({
        delivered_amount: 'not-a-drop-amount',
        Amount: '1000000',
      })
    ).toBeNull()
  })

  it('returns null for missing or non-object metadata', () => {
    expect(readRippleDeliveredAmount(undefined)).toBeNull()
    expect(readRippleDeliveredAmount(null)).toBeNull()
    expect(readRippleDeliveredAmount('tesSUCCESS')).toBeNull()
    expect(readRippleDeliveredAmount({})).toBeNull()
  })
})
