import { describe, expect, it } from 'vitest'

import limitSwapMemoFixtures from '../../fixtures/limit-swap-memos.json'
import type { LimitSwapMemoInput, LimitSwapSourceChainKind } from './limitSwapMemo'
import {
  assertMemoByteLength,
  buildLimitSwapMemo,
  getLimitSwapLimitAmount,
  getLimitSwapSourceChainKind,
  validateLimitSwapInputs,
} from './limitSwapMemo'

type LimitSwapMemoFixture = {
  name: string
  source_chain_kind: LimitSwapSourceChainKind
  affiliate_included: boolean
  inputs: LimitSwapMemoInput
  expected_memo: string
}

const fixtures = limitSwapMemoFixtures as LimitSwapMemoFixture[]

const validInput: LimitSwapMemoInput = {
  source_asset: 'BTC.BTC',
  source_amount: 100_000_000,
  target_asset: 'ETH.ETH',
  dest_addr: '0x742d35Cc6634C0532925a3b844Bc9e7595f12345',
  target_price: 16,
  expiry_hours: 24,
}

describe('buildLimitSwapMemo', () => {
  it.each(fixtures)('matches fixture $name', ({ inputs, expected_memo, source_chain_kind, affiliate_included }) => {
    const memo = buildLimitSwapMemo(inputs)

    expect(memo).toBe(expected_memo)
    expect(getLimitSwapSourceChainKind(inputs.source_asset)).toBe(source_chain_kind)
    expect(memo.includes(':v0:50')).toBe(affiliate_included)
  })

  it('computes LIM with integer math and floors sub-1e8 remainders', () => {
    expect(
      getLimitSwapLimitAmount({
        source_amount: 123_456_789,
        target_price: '1.23456789',
      })
    ).toBe(152_415_787n)
  })

  it('drops affiliate on UTXO source memos only when required by the 80-byte cap', () => {
    expect(
      buildLimitSwapMemo({
        ...validInput,
        target_asset: 'THOR.RUNE',
        dest_addr: 'thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6',
        expiry_hours: 24,
      })
    ).toBe('=<:THOR.RUNE:thor1x2whgc2nt665y0kc44uywhynazvp0l8tp0vtu6:1600000000/14400/0')
  })
})

describe('validateLimitSwapInputs', () => {
  it('accepts valid inputs', () => {
    expect(() => validateLimitSwapInputs(validInput)).not.toThrow()
  })

  it('rejects unsupported source assets', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_asset: 'NOPE.NOPE',
      })
    ).toThrow(/unsupported THORChain asset prefix/)
  })

  it('rejects unsupported target assets', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_asset: 'NOPE.NOPE',
      })
    ).toThrow(/unsupported THORChain asset prefix/)
  })

  it('rejects malformed destination addresses', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'not-an-address',
      })
    ).toThrow(/valid Ethereum address/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'bc1q has spaces',
      })
    ).toThrow(/whitespace/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        dest_addr: 'aaaaaaaaaa',
      })
    ).toThrow(/valid Ethereum address/)
  })

  it('rejects invalid source amounts', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_amount: 0,
      })
    ).toThrow(/positive safe integer/)

    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        source_amount: '1.1',
      })
    ).toThrow(/positive integer/)
  })

  it('rejects non-positive target prices', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_price: '0',
      })
    ).toThrow(/greater than 0/)
  })

  it('rejects target prices with more than 8 fractional digits', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        target_price: '1.123456789',
      })
    ).toThrow(/at most 8 fractional digits/)
  })

  it('accepts tiny numeric target prices with 8 decimal places', () => {
    expect(
      getLimitSwapLimitAmount({
        source_amount: 100_000_000,
        target_price: 0.00000001,
      })
    ).toBe(1n)
  })

  it('rejects unsupported expiries', () => {
    expect(() =>
      validateLimitSwapInputs({
        ...validInput,
        expiry_hours: 6 as 12,
      })
    ).toThrow(/expiry_hours/)
  })

  it.each(['BTC.BTC', 'BCH.BCH', 'DASH.DASH', 'DOGE.DOGE', 'LTC.LTC', 'ZEC.ZEC'])(
    'applies the UTXO memo byte rule for %s sources',
    source_asset => {
      expect(getLimitSwapSourceChainKind(source_asset)).toBe('utxo')
      expect(
        new TextEncoder().encode(
          buildLimitSwapMemo({
            ...validInput,
            source_asset,
          })
        ).length
      ).toBeLessThanOrEqual(80)
    }
  )
})

describe('assertMemoByteLength', () => {
  it('measures UTF-8 bytes, not JavaScript string length', () => {
    expect(() => assertMemoByteLength('€'.repeat(27), 'utxo')).toThrow(/81 bytes/)
  })

  it('throws when a UTXO memo exceeds 80 bytes', () => {
    expect(() => assertMemoByteLength('x'.repeat(81), 'utxo')).toThrow(/exceeding utxo limit 80/)
  })

  it('allows non-UTXO memos up to 250 bytes', () => {
    expect(() => assertMemoByteLength('x'.repeat(250), 'other')).not.toThrow()
  })
})
