import { describe, expect, it } from 'vitest'

import { normalizeTokenSymbol } from './tokenSymbol'

describe('normalizeTokenSymbol', () => {
  it('upper-cases and keeps plain ASCII tickers intact', () => {
    expect(normalizeTokenSymbol('usdt')).toBe('USDT')
    expect(normalizeTokenSymbol('NOT')).toBe('NOT')
  })

  it("folds Tether's tugrik sign so the whitelist symbol matches the curated ticker", () => {
    expect(normalizeTokenSymbol('USD₮')).toBe('USDT')
  })

  it('maps Cyrillic and Greek homoglyphs onto their Latin look-alikes', () => {
    expect(normalizeTokenSymbol('UЅDT')).toBe('USDT')
    expect(normalizeTokenSymbol('ΤΟΝ')).toBe('TON')
  })

  it('drops decoration, whitespace, diacritics and stroked letters', () => {
    expect(normalizeTokenSymbol('$USĐ₮')).toBe('USDT')
    expect(normalizeTokenSymbol('Tether USD')).toBe('TETHERUSD')
    expect(normalizeTokenSymbol(' dogs ')).toBe('DOGS')
    expect(normalizeTokenSymbol('Ｕ𝐒Ｄ𝐓')).toBe('USDT')
  })

  it('returns an empty string when nothing alphanumeric survives', () => {
    expect(normalizeTokenSymbol('💎')).toBe('')
    expect(normalizeTokenSymbol('')).toBe('')
  })

  it('does not equate genuinely different tickers', () => {
    expect(normalizeTokenSymbol('USTD')).not.toBe('USDT')
    expect(normalizeTokenSymbol('USD')).not.toBe('USDT')
  })
})
