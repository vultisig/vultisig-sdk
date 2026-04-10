import { describe, expect, it } from 'vitest'

import { addLpMemo, removeLpMemo } from './memo'

describe('addLpMemo', () => {
  it('emits a pure-asym memo when no paired address is provided', () => {
    expect(addLpMemo({ pool: 'BTC.BTC' })).toBe('+:BTC.BTC')
  })

  it('emits a paired memo when pairedAddress is provided', () => {
    expect(
      addLpMemo({
        pool: 'BTC.BTC',
        pairedAddress: 'bc1qaddress',
      })
    ).toBe('+:BTC.BTC:bc1qaddress')
  })

  it('treats an empty-string pairedAddress as no pairing', () => {
    expect(
      addLpMemo({
        pool: 'BTC.BTC',
        pairedAddress: '',
      })
    ).toBe('+:BTC.BTC')
  })

  it('handles ERC-20 pool ids with contract suffix', () => {
    expect(
      addLpMemo({
        pool: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        pairedAddress: '0xabcdef1234567890abcdef1234567890abcdef12',
      })
    ).toBe(
      '+:ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48:0xabcdef1234567890abcdef1234567890abcdef12'
    )
  })

  it('never includes an affiliate suffix — matches iOS and vultisig-windows extension', () => {
    const memo = addLpMemo({ pool: 'BTC.BTC', pairedAddress: 'bc1q' })
    expect(memo).not.toContain('vi')
    expect(memo).not.toContain('ss')
    // Exactly two or three colon-separated segments, never four or five
    const parts = memo.split(':')
    expect(parts.length).toBeGreaterThanOrEqual(2)
    expect(parts.length).toBeLessThanOrEqual(3)
  })

  it('rejects invalid pool ids via assertValidPoolId', () => {
    expect(() => addLpMemo({ pool: 'btc.btc' })).toThrow(/valid THORChain pool id/)
    expect(() => addLpMemo({ pool: 'BTC' })).toThrow(/valid THORChain pool id/)
    expect(() => addLpMemo({ pool: '' })).toThrow(/non-empty string/)
  })
})

describe('removeLpMemo', () => {
  it('emits a 100% withdraw memo for 10000 bps', () => {
    expect(removeLpMemo({ pool: 'BTC.BTC', basisPoints: 10000 })).toBe(
      '-:BTC.BTC:10000'
    )
  })

  it('emits a partial withdraw memo for 2500 bps', () => {
    expect(removeLpMemo({ pool: 'ETH.ETH', basisPoints: 2500 })).toBe(
      '-:ETH.ETH:2500'
    )
  })

  it('appends withdrawToAsset suffix when provided', () => {
    expect(
      removeLpMemo({
        pool: 'BTC.BTC',
        basisPoints: 10000,
        withdrawToAsset: 'BTC',
      })
    ).toBe('-:BTC.BTC:10000:BTC')
  })

  it('honors withdrawToAsset on partial withdraws too', () => {
    expect(
      removeLpMemo({
        pool: 'ETH.ETH',
        basisPoints: 5000,
        withdrawToAsset: 'ETH',
      })
    ).toBe('-:ETH.ETH:5000:ETH')
  })

  it('treats empty-string withdrawToAsset as no asym target', () => {
    expect(
      removeLpMemo({
        pool: 'BTC.BTC',
        basisPoints: 10000,
        withdrawToAsset: '',
      })
    ).toBe('-:BTC.BTC:10000')
  })

  it.each([0, -1, 10001, 1.5, NaN])(
    'rejects out-of-range or non-integer basisPoints (%s)',
    bps => {
      expect(() =>
        removeLpMemo({ pool: 'BTC.BTC', basisPoints: bps })
      ).toThrow(/basisPoints/)
    }
  )

  it('never includes an affiliate suffix', () => {
    const memo = removeLpMemo({ pool: 'BTC.BTC', basisPoints: 10000 })
    expect(memo).not.toContain('vi')
    expect(memo).not.toContain('ss')
  })
})
