/**
 * Unit Tests: SeedphraseValidator
 *
 * Tests mnemonic validation functionality with multi-language support.
 * Uses @scure/bip39 for actual validation (no mocking needed).
 */

import { describe, expect, it, vi } from 'vitest'

import type { WasmProvider } from '../../../src/context/WasmProvider'
import { cleanMnemonic, SeedphraseValidator } from '../../../src/seedphrase/SeedphraseValidator'

// Create a minimal mock WasmProvider (not used for validation anymore, but required by constructor)
const createMockWasmProvider = (): WasmProvider => ({
  getWalletCore: vi.fn(),
  getDkls: vi.fn(),
  getSchnorr: vi.fn(),
  ensureInitialized: vi.fn(),
})

// Valid 12-word test mnemonics (with valid checksums)
const VALID_ENGLISH_12 = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VALID_ENGLISH_24 =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
const VALID_JAPANESE_12 =
  'あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あいこくしん あおぞら'
const VALID_SPANISH_12 = 'ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco ábaco abierto'

describe('cleanMnemonic', () => {
  it('should trim whitespace', () => {
    expect(cleanMnemonic('  word1 word2 word3  ')).toBe('word1 word2 word3')
  })

  it('should convert to lowercase', () => {
    expect(cleanMnemonic('Word1 WORD2 WoRd3')).toBe('word1 word2 word3')
  })

  it('should normalize multiple spaces to single space', () => {
    expect(cleanMnemonic('word1    word2  word3')).toBe('word1 word2 word3')
  })

  it('should handle newlines and tabs', () => {
    expect(cleanMnemonic('word1\nword2\tword3')).toBe('word1 word2 word3')
  })

  it('should handle mixed whitespace', () => {
    expect(cleanMnemonic('  Word1  \n  WORD2  \t  word3  ')).toBe('word1 word2 word3')
  })

  it('should handle empty string', () => {
    expect(cleanMnemonic('')).toBe('')
  })

  it('should handle single word', () => {
    expect(cleanMnemonic('  ABANDON  ')).toBe('abandon')
  })

  it('should convert Japanese ideographic space to regular space', () => {
    expect(cleanMnemonic('word1\u3000word2\u3000word3')).toBe('word1 word2 word3')
  })
})

describe('SeedphraseValidator', () => {
  describe('validate - basic functionality', () => {
    it('should return valid for 12-word valid English mnemonic', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_ENGLISH_12)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
      expect(result.detectedLanguage).toBe('english')
      expect(result.error).toBeUndefined()
      expect(result.invalidWords).toBeUndefined()
    })

    it('should return valid for 24-word valid English mnemonic', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_ENGLISH_24)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(24)
      expect(result.detectedLanguage).toBe('english')
    })

    it('should return invalid for wrong word count (11 words)', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const mnemonic = Array(11).fill('abandon').join(' ')
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(11)
      expect(result.error).toContain('12 or 24')
    })

    it('should return invalid for wrong word count (15 words)', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const mnemonic = Array(15).fill('abandon').join(' ')
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(15)
    })

    it('should return invalid for empty mnemonic', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate('')

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(0)
      expect(result.error).toBe('Mnemonic is empty')
    })

    it('should return invalid for whitespace-only input', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate('   \n\t   ')

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(0)
    })

    it('should return invalid for invalid words', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const mnemonic = 'invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.invalidWords).toBeDefined()
      expect(result.invalidWords).toContain('invalid')
    })

    it('should clean mnemonic before validation', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const messyMnemonic =
        '  ABANDON  abandon  ABANDON  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  ABOUT  '
      const result = await validator.validate(messyMnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
    })
  })

  describe('validate - multi-language support', () => {
    it('should auto-detect and validate Japanese mnemonic', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_JAPANESE_12)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
      expect(result.detectedLanguage).toBe('japanese')
    })

    it('should auto-detect and validate Spanish mnemonic', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_SPANISH_12)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
      expect(result.detectedLanguage).toBe('spanish')
    })

    it('should handle Japanese ideographic space', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      // Use ideographic space (U+3000) between words
      const jpMnemonic =
        'あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あいこくしん\u3000あおぞら'
      const result = await validator.validate(jpMnemonic)

      expect(result.valid).toBe(true)
      expect(result.detectedLanguage).toBe('japanese')
    })

    it('should validate with explicit English language', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_ENGLISH_12, { language: 'english' })

      expect(result.valid).toBe(true)
      expect(result.detectedLanguage).toBe('english')
    })

    it('should validate with explicit Japanese language', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_JAPANESE_12, { language: 'japanese' })

      expect(result.valid).toBe(true)
      expect(result.detectedLanguage).toBe('japanese')
    })

    it('should reject Japanese mnemonic when English is specified', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_JAPANESE_12, { language: 'english' })

      expect(result.valid).toBe(false)
      expect(result.detectedLanguage).toBe('english')
      expect(result.invalidWords).toBeDefined()
    })

    it('should reject English mnemonic when Japanese is specified', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const result = await validator.validate(VALID_ENGLISH_12, { language: 'japanese' })

      expect(result.valid).toBe(false)
      expect(result.detectedLanguage).toBe('japanese')
      expect(result.invalidWords).toBeDefined()
    })
  })

  describe('validate - checksum validation', () => {
    it('should reject mnemonic with invalid checksum (valid words, wrong last word)', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      // All valid English words, but wrong checksum (changed 'about' to 'abandon')
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      // All words are valid, so invalidWords should be empty
      expect(result.invalidWords).toBeUndefined()
      // With auto-detection, invalid checksum means no language matches
      expect(result.error).toBeTruthy()
    })

    it('should report checksum failure when explicit language is specified', async () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      // All valid English words, but wrong checksum
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await validator.validate(mnemonic, { language: 'english' })

      expect(result.valid).toBe(false)
      expect(result.invalidWords).toBeUndefined()
      expect(result.error).toContain('checksum')
    })
  })

  describe('getSuggestions', () => {
    it('should return English suggestions by default', () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const suggestions = validator.getSuggestions('ab')

      expect(suggestions.length).toBeLessThanOrEqual(10)
      expect(suggestions.every(s => s.startsWith('ab'))).toBe(true)
      expect(suggestions).toContain('abandon')
      expect(suggestions).toContain('ability')
    })

    it('should return suggestions for specified language', () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const suggestions = validator.getSuggestions('あい', 'japanese')

      expect(suggestions.length).toBeGreaterThan(0)
      expect(suggestions.every(s => s.startsWith('あい'))).toBe(true)
    })

    it('should respect limit parameter', () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const suggestions = validator.getSuggestions('a', 'english', 3)

      expect(suggestions.length).toBeLessThanOrEqual(3)
    })

    it('should return empty array for no matches', () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const suggestions = validator.getSuggestions('xyz', 'english')

      expect(suggestions).toEqual([])
    })

    it('should be case-insensitive', () => {
      const validator = new SeedphraseValidator(createMockWasmProvider())
      const lowerSuggestions = validator.getSuggestions('ab', 'english')
      const upperSuggestions = validator.getSuggestions('AB', 'english')

      expect(lowerSuggestions).toEqual(upperSuggestions)
    })
  })
})
