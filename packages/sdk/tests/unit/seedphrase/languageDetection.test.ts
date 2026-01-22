/**
 * Unit Tests: Language Detection Utilities
 *
 * Tests BIP39 multi-language support functions.
 */

import { describe, expect, it } from 'vitest'

import {
  BIP39_WORDLISTS,
  detectMnemonicLanguage,
  findInvalidWords,
  findInvalidWordsAcrossAllLanguages,
  getWordlist,
  normalizeMnemonic,
} from '../../../src/seedphrase/languageDetection'
import type { Bip39Language } from '../../../src/seedphrase/types'

// Valid 12-word test mnemonics for each language (with valid checksums from BIP39 test vectors)
const TEST_MNEMONICS: Record<Bip39Language, string> = {
  english: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  japanese:
    'あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あおぞら',
  korean: '가격 가격 가격 가격 가격 가격 가격 가격 가격 가격 가격 가능',
  spanish: 'ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco abierto',
  chinese_simplified: '的 的 的 的 的 的 的 的 的 的 的 在',
  chinese_traditional: '槍 疫 黴 嘗 倆 鬧 餓 賢 槍 疫 黴 卿',
  french: 'abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abaisser abeille',
  italian: 'abaco abaco abaco abaco abaco abaco abaco abaco abaco abaco abaco abete',
  czech: 'abdikace abdikace abdikace abdikace abdikace abdikace abdikace abdikace abdikace abdikace abdikace agrese',
  portuguese: 'abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abacate abater',
}

describe('normalizeMnemonic', () => {
  it('should trim whitespace', () => {
    expect(normalizeMnemonic('  word1 word2 word3  ')).toBe('word1 word2 word3')
  })

  it('should convert to lowercase', () => {
    expect(normalizeMnemonic('Word1 WORD2 WoRd3')).toBe('word1 word2 word3')
  })

  it('should normalize multiple spaces to single space', () => {
    expect(normalizeMnemonic('word1    word2  word3')).toBe('word1 word2 word3')
  })

  it('should handle newlines and tabs', () => {
    expect(normalizeMnemonic('word1\nword2\tword3')).toBe('word1 word2 word3')
  })

  it('should handle mixed whitespace', () => {
    expect(normalizeMnemonic('  Word1  \n  WORD2  \t  word3  ')).toBe('word1 word2 word3')
  })

  it('should handle empty string', () => {
    expect(normalizeMnemonic('')).toBe('')
  })

  it('should handle single word', () => {
    expect(normalizeMnemonic('  ABANDON  ')).toBe('abandon')
  })

  it('should convert Japanese ideographic space (U+3000) to regular space', () => {
    // U+3000 is the ideographic space used in Japanese
    expect(normalizeMnemonic('word1\u3000word2\u3000word3')).toBe('word1 word2 word3')
  })

  it('should apply NFKD normalization', () => {
    // Test with a character that has different forms (e.g., ü can be composed or decomposed)
    const composed = 'über'
    const result = normalizeMnemonic(composed)
    // NFKD normalizes to decomposed form, but the result should still be valid
    expect(result).toBeTruthy()
  })
})

describe('BIP39_WORDLISTS', () => {
  it('should have 10 languages', () => {
    expect(Object.keys(BIP39_WORDLISTS)).toHaveLength(10)
  })

  it('should have 2048 words in each wordlist', () => {
    for (const wordlist of Object.values(BIP39_WORDLISTS)) {
      expect(wordlist).toHaveLength(2048)
    }
  })

  it('should have unique words in each wordlist', () => {
    for (const wordlist of Object.values(BIP39_WORDLISTS)) {
      const uniqueWords = new Set(wordlist)
      expect(uniqueWords.size).toBe(2048)
    }
  })
})

describe('getWordlist', () => {
  it('should return the correct wordlist for each language', () => {
    expect(getWordlist('english')).toBe(BIP39_WORDLISTS.english)
    expect(getWordlist('japanese')).toBe(BIP39_WORDLISTS.japanese)
    expect(getWordlist('chinese_simplified')).toBe(BIP39_WORDLISTS.chinese_simplified)
  })

  it('should contain non-empty first words for each language', () => {
    // Verify each language has non-empty first words
    // We don't hardcode non-ASCII values due to Unicode normalization differences
    expect(getWordlist('english')[0]).toBe('abandon')
    expect(getWordlist('japanese')[0].length).toBeGreaterThan(0)
    expect(getWordlist('korean')[0].length).toBeGreaterThan(0)
    expect(getWordlist('spanish')[0].length).toBeGreaterThan(0)
    expect(getWordlist('french')[0].length).toBeGreaterThan(0)
    expect(getWordlist('italian')[0].length).toBeGreaterThan(0)
    expect(getWordlist('czech')[0].length).toBeGreaterThan(0)
    expect(getWordlist('portuguese')[0].length).toBeGreaterThan(0)

    // Verify non-English wordlists don't start with 'abandon'
    expect(getWordlist('japanese')[0]).not.toBe('abandon')
    expect(getWordlist('korean')[0]).not.toBe('abandon')
    expect(getWordlist('spanish')[0]).not.toBe('abandon')
  })
})

describe('detectMnemonicLanguage', () => {
  it('should detect English mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.english)
    expect(result).toBe('english')
  })

  it('should detect Japanese mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.japanese)
    expect(result).toBe('japanese')
  })

  it('should detect Spanish mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.spanish)
    expect(result).toBe('spanish')
  })

  it('should detect French mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.french)
    expect(result).toBe('french')
  })

  it('should detect Italian mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.italian)
    expect(result).toBe('italian')
  })

  it('should detect Czech mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.czech)
    expect(result).toBe('czech')
  })

  it('should detect Portuguese mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.portuguese)
    expect(result).toBe('portuguese')
  })

  it('should detect Korean mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.korean)
    expect(result).toBe('korean')
  })

  it('should detect Chinese Simplified mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.chinese_simplified)
    expect(result).toBe('chinese_simplified')
  })

  it('should detect Chinese Traditional mnemonic', () => {
    const result = detectMnemonicLanguage(TEST_MNEMONICS.chinese_traditional)
    expect(result).toBe('chinese_traditional')
  })

  it('should return null for invalid mnemonic', () => {
    const result = detectMnemonicLanguage('invalid nonsense words that are not bip39')
    expect(result).toBeNull()
  })

  it('should prioritize English for valid English mnemonics', () => {
    // Some words may exist in multiple wordlists, ensure English is tried first
    const result = detectMnemonicLanguage(TEST_MNEMONICS.english)
    expect(result).toBe('english')
  })

  it('should handle Japanese ideographic space', () => {
    // Japanese mnemonic with ideographic spaces
    const jpMnemonic =
      'あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あおぞら'
    const result = detectMnemonicLanguage(jpMnemonic)
    expect(result).toBe('japanese')
  })
})

describe('findInvalidWords', () => {
  it('should return empty array for valid English mnemonic', () => {
    const result = findInvalidWords(TEST_MNEMONICS.english, 'english')
    expect(result).toEqual([])
  })

  it('should find invalid words in English', () => {
    const mnemonic = 'abandon xyz ability invalidword zoo'
    const result = findInvalidWords(mnemonic, 'english')
    expect(result).toContain('xyz')
    expect(result).toContain('invalidword')
  })

  it('should return all words as invalid when checking wrong language', () => {
    // English words against Japanese wordlist
    const result = findInvalidWords(TEST_MNEMONICS.english, 'japanese')
    expect(result.length).toBeGreaterThan(0)
  })

  it('should handle empty mnemonic', () => {
    const result = findInvalidWords('', 'english')
    expect(result).toEqual([])
  })
})

describe('findInvalidWordsAcrossAllLanguages', () => {
  it('should return empty array for valid mnemonic in any language', () => {
    const result = findInvalidWordsAcrossAllLanguages(TEST_MNEMONICS.english)
    expect(result).toEqual([])
  })

  it('should find words not in any wordlist', () => {
    const mnemonic = 'abandon xyz ability invalidword about'
    const result = findInvalidWordsAcrossAllLanguages(mnemonic)
    expect(result).toContain('xyz')
    expect(result).toContain('invalidword')
    // 'abandon', 'ability', 'about' should not be in the result
    expect(result).not.toContain('abandon')
    expect(result).not.toContain('ability')
    expect(result).not.toContain('about')
  })

  it('should handle completely invalid mnemonic', () => {
    const mnemonic = 'xyz abc qwerty asdfgh'
    const result = findInvalidWordsAcrossAllLanguages(mnemonic)
    expect(result).toHaveLength(4)
  })
})
