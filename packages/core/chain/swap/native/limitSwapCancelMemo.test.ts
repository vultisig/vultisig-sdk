import { describe, expect, it } from 'vitest'

import {
  buildCancelLimitSwapMemo,
  doesCancelLimitSwapMemoFit,
  isAbbreviatedThorchainMemoAsset,
  isCancelLimitSwapMemo,
  isModifyLimitSwapMemo,
  LimitSwapCancelInputs,
} from './limitSwapCancelMemo'

const fullUsdc = 'ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48'

const runeToUsdc: LimitSwapCancelInputs = {
  sourceAsset: 'THOR.RUNE',
  sourceAmount: 100_000_000n,
  targetAsset: fullUsdc,
  tradeTarget: 43_079_145n,
}

describe('buildCancelLimitSwapMemo', () => {
  // Coins are `<amount><ASSET>` with no space; the trailing 0 is what makes it
  // a cancel rather than a retarget.
  it('builds the three-field cancel form', () => {
    expect(buildCancelLimitSwapMemo(runeToUsdc)).toBe(`m=<:100000000THOR.RUNE:43079145${fullUsdc}:0`)
  })

  // The placement memo's LIM understands scientific notation; these coins go
  // through cosmos.ParseCoins, which does not.
  it('emits plain decimal integers, never compressed', () => {
    const memo = buildCancelLimitSwapMemo({
      ...runeToUsdc,
      sourceAmount: 544_000_000n,
    })

    expect(memo).toContain('544000000THOR.RUNE')
    expect(memo).not.toContain('e')
  })

  // A secured source must keep its secured denom: ValidateBasic enforces
  // From.IsChain(Source.Asset.GetChain()), and the L1 spelling makes GetChain()
  // report the L1 chain, rejecting a cancel sent from a THOR address.
  it('passes a secured denom through unchanged', () => {
    const memo = buildCancelLimitSwapMemo({
      ...runeToUsdc,
      sourceAsset: 'eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    })

    expect(memo).toContain('eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })

  // This memo type skips fuzzyAssetMatch, so an abbreviation addresses a bucket
  // that by construction holds nothing: accepted, charged, cancels nothing.
  it.each([
    ['an abbreviated source', { sourceAsset: 'ETH.USDC-06EB48' }],
    ['an abbreviated target', { targetAsset: 'ETH.USDC-06EB48' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => buildCancelLimitSwapMemo({ ...runeToUsdc, ...overrides })).toThrow(/full token identifier/)
  })

  it.each([
    ['a zero source amount', { sourceAmount: 0n }],
    ['a zero trade target', { tradeTarget: 0n }],
    ['a negative amount', { sourceAmount: -1n }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => buildCancelLimitSwapMemo({ ...runeToUsdc, ...overrides })).toThrow(/positive/)
  })

  // THORNode's getCoin splices its own space between amount and asset, so a
  // stray one corrupts the coin field and the cancel matches nothing.
  it('trims surrounding whitespace rather than emitting it', () => {
    expect(buildCancelLimitSwapMemo({ ...runeToUsdc, sourceAsset: '  THOR.RUNE  ' })).toBe(
      buildCancelLimitSwapMemo(runeToUsdc)
    )
  })

  it.each([
    ['an empty source asset', { sourceAsset: '' }],
    ['a whitespace target asset', { targetAsset: '   ' }],
  ])('refuses %s', (_label, overrides) => {
    expect(() => buildCancelLimitSwapMemo({ ...runeToUsdc, ...overrides })).toThrow(/required/)
  })
})

describe('isAbbreviatedThorchainMemoAsset', () => {
  it.each([
    ['ETH.USDC-06EB48', true],
    [fullUsdc, false],
    // No identifier at all — full by construction. Native and secured-native
    // legs must stay cancellable.
    ['BTC.BTC', false],
    ['THOR.RUNE', false],
    ['THOR.TCY', false],
    ['btc-btc', false],
    // A secured token's chain prefix uses `-`, so reading the tail after the
    // LAST `-` would call a secured native truncated.
    ['eth-usdc-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', false],
  ])('reads %s as abbreviated=%s', (asset, expected) => {
    expect(isAbbreviatedThorchainMemoAsset(asset)).toBe(expected)
  })
})

describe('isModifyLimitSwapMemo / isCancelLimitSwapMemo', () => {
  const cancel = buildCancelLimitSwapMemo(runeToUsdc)
  const retarget = cancel.replace(/:0$/, ':50000000')

  it('recognises a cancel as both a modify and a cancel', () => {
    expect(isModifyLimitSwapMemo(cancel)).toBe(true)
    expect(isCancelLimitSwapMemo(cancel)).toBe(true)
  })

  // A retarget is a different action with a different outcome. Treating it as a
  // cancel would be a lie the day someone builds modify.
  it('recognises a retarget as a modify but NOT a cancel', () => {
    expect(isModifyLimitSwapMemo(retarget)).toBe(true)
    expect(isCancelLimitSwapMemo(retarget)).toBe(false)
  })

  // THORNode's getUint reads the field numerically, so "00" is zero there; a
  // string comparison would call it a retarget.
  it('reads a zero-padded final field as a cancel', () => {
    expect(isCancelLimitSwapMemo(cancel.replace(/:0$/, ':00'))).toBe(true)
  })

  // Digits only, so a sign cannot smuggle "-0" past an unsigned field.
  it('refuses a signed final field', () => {
    expect(isCancelLimitSwapMemo(cancel.replace(/:0$/, ':-0'))).toBe(false)
  })

  it.each([
    ['a placement memo', '=<:ETH.ETH:0xabc:100/14400/0'],
    ['an empty final field', 'm=<:1THOR.RUNE:1BTC.BTC:'],
    ['a plain send', 'hello'],
    ['no memo', undefined],
  ])('reads %s as not a cancel', (_label, memo) => {
    expect(isCancelLimitSwapMemo(memo)).toBe(false)
  })
})

describe('doesCancelLimitSwapMemoFit', () => {
  it('accepts a cancel within the non-UTXO budget', () => {
    expect(doesCancelLimitSwapMemoFit(buildCancelLimitSwapMemo(runeToUsdc), 'other')).toBe(true)
  })

  // Two full-contract assets plus two exact amounts overflow OP_RETURN, and
  // nothing in a cancel memo can be shortened. Such orders refund at expiry.
  it('rejects a full-contract pair from a UTXO source', () => {
    const memo = buildCancelLimitSwapMemo({
      sourceAsset: 'BTC.BTC',
      sourceAmount: 100_000_000n,
      targetAsset: fullUsdc,
      tradeTarget: 43_079_145n,
    })

    expect(memo.length).toBeGreaterThan(80)
    expect(doesCancelLimitSwapMemoFit(memo, 'utxo')).toBe(false)
  })

  it('accepts a native pair from a UTXO source', () => {
    const memo = buildCancelLimitSwapMemo({
      sourceAsset: 'BTC.BTC',
      sourceAmount: 100_000_000n,
      targetAsset: 'THOR.RUNE',
      tradeTarget: 43_079_145n,
    })

    expect(doesCancelLimitSwapMemoFit(memo, 'utxo')).toBe(true)
  })
})
