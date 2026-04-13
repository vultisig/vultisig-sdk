import { describe, expect, it } from 'vitest'

import {
  VULTISIG_AFFILIATE_LP_BPS,
  VULTISIG_AFFILIATE_NAME,
} from './affiliate'
import { addLpMemo, removeLpMemo } from './memo'

describe('addLpMemo', () => {
  it('emits the asym RUNE-side default memo with vultisig affiliate at 0 bps', () => {
    expect(addLpMemo({ pool: 'BTC.BTC' })).toBe('+:BTC.BTC::vi:0')
  })

  it('emits a symmetric memo when a paired address is provided', () => {
    expect(
      addLpMemo({
        pool: 'BTC.BTC',
        pairedAddress: 'bc1qaddress',
      })
    ).toBe('+:BTC.BTC:bc1qaddress:vi:0')
  })

  it('honors caller-provided affiliate and bps overrides', () => {
    expect(
      addLpMemo({
        pool: 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48',
        affiliate: 'ss',
        affiliateBps: 60,
      })
    ).toBe(
      '+:ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48::ss:60'
    )
  })

  it('uses the affiliate constants from the affiliate module', () => {
    const memo = addLpMemo({ pool: 'BTC.BTC' })
    expect(memo).toContain(`:${VULTISIG_AFFILIATE_NAME}:`)
    expect(memo).toMatch(new RegExp(`:${VULTISIG_AFFILIATE_LP_BPS}$`))
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

  it.each([0, -1, 10001, 1.5, NaN])(
    'rejects out-of-range or non-integer basisPoints (%s)',
    bps => {
      expect(() =>
        removeLpMemo({ pool: 'BTC.BTC', basisPoints: bps })
      ).toThrow(/basisPoints/)
    }
  )

  it('does not append an affiliate suffix to withdraws', () => {
    const memo = removeLpMemo({ pool: 'BTC.BTC', basisPoints: 10000 })
    expect(memo).not.toContain('vi')
    expect(memo.split(':')).toHaveLength(3)
  })
})
