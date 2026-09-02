import { describe, expect, it } from 'vitest'

import { normalizeJettonSymbol } from './symbol'

describe('normalizeJettonSymbol', () => {
  it('upper-cases and keeps plain ASCII tickers intact', () => {
    expect(normalizeJettonSymbol('usdt')).toBe('USDT')
    expect(normalizeJettonSymbol('NOT')).toBe('NOT')
  })

  it("folds Tether's tugrik sign so the whitelist symbol matches the curated ticker", () => {
    expect(normalizeJettonSymbol('USD₮')).toBe('USDT')
  })

  it('maps Cyrillic and Greek homoglyphs onto their Latin look-alikes', () => {
    expect(normalizeJettonSymbol('UЅDT')).toBe('USDT')
    expect(normalizeJettonSymbol('ΤΟΝ')).toBe('TON')
  })

  it('drops decoration, whitespace, diacritics and stroked letters', () => {
    expect(normalizeJettonSymbol('$USĐ₮')).toBe('USDT')
    expect(normalizeJettonSymbol('Tether USD')).toBe('TETHERUSD')
    expect(normalizeJettonSymbol(' dogs ')).toBe('DOGS')
    expect(normalizeJettonSymbol('Ｕ𝐒Ｄ𝐓')).toBe('USDT')
  })

  it('returns an empty string when nothing alphanumeric survives', () => {
    expect(normalizeJettonSymbol('💎')).toBe('')
    expect(normalizeJettonSymbol('')).toBe('')
  })

  it('does not equate genuinely different tickers', () => {
    expect(normalizeJettonSymbol('USTD')).not.toBe('USDT')
    expect(normalizeJettonSymbol('USD')).not.toBe('USDT')
  })
})
