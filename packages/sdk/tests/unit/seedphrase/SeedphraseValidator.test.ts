/**
 * Unit Tests: SeedphraseValidator
 *
 * Tests mnemonic validation functionality with mocked WalletCore.
 * Integration tests with real WASM are in the integration folder.
 */

import { describe, expect, it, vi } from 'vitest'

import type { WasmProvider } from '../../../src/context/WasmProvider'
import { cleanMnemonic, SeedphraseValidator } from '../../../src/seedphrase/SeedphraseValidator'

// Mock WalletCore
const createMockWalletCore = (isValidFn: (mnemonic: string) => boolean) => ({
  Mnemonic: {
    isValid: isValidFn,
  },
})

const createMockWasmProvider = (isValidFn: (mnemonic: string) => boolean): WasmProvider => ({
  getWalletCore: vi.fn().mockResolvedValue(createMockWalletCore(isValidFn)),
  getDkls: vi.fn(),
  getSchnorr: vi.fn(),
  ensureInitialized: vi.fn(),
})

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
})

describe('SeedphraseValidator', () => {
  describe('validate', () => {
    it('should return valid for 12-word valid mnemonic', async () => {
      const mockProvider = createMockWasmProvider(() => true)
      const validator = new SeedphraseValidator(mockProvider)

      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
      expect(result.error).toBeUndefined()
      expect(result.invalidWords).toBeUndefined()
    })

    it('should return valid for 24-word valid mnemonic', async () => {
      const mockProvider = createMockWasmProvider(() => true)
      const validator = new SeedphraseValidator(mockProvider)

      const mnemonic = Array(24).fill('abandon').join(' ')
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(24)
    })

    it('should return invalid for wrong word count', async () => {
      const mockProvider = createMockWasmProvider(() => true)
      const validator = new SeedphraseValidator(mockProvider)

      // 11 words
      const mnemonic = Array(11).fill('abandon').join(' ')
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(11)
      expect(result.error).toContain('12 or 24')
    })

    it('should return invalid for 15-word mnemonic', async () => {
      const mockProvider = createMockWasmProvider(() => true)
      const validator = new SeedphraseValidator(mockProvider)

      const mnemonic = Array(15).fill('abandon').join(' ')
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(15)
    })

    it('should return invalid for empty mnemonic', async () => {
      const mockProvider = createMockWasmProvider(() => false)
      const validator = new SeedphraseValidator(mockProvider)

      const result = await validator.validate('')

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(0)
    })

    it('should return invalid when WalletCore validation fails', async () => {
      const mockProvider = createMockWasmProvider(() => false)
      const validator = new SeedphraseValidator(mockProvider)

      const mnemonic = 'invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid invalid'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      // Error can be "Invalid mnemonic (checksum failed)" or "Invalid words: ..."
      expect(result.error).toBeTruthy()
    })

    it('should clean mnemonic before validation', async () => {
      const capturedMnemonic: string[] = []
      const mockWalletCore = {
        Mnemonic: {
          isValid: (m: string) => {
            capturedMnemonic.push(m)
            return true
          },
        },
      }
      const mockProvider: WasmProvider = {
        getWalletCore: vi.fn().mockResolvedValue(mockWalletCore),
        getDkls: vi.fn(),
        getSchnorr: vi.fn(),
        ensureInitialized: vi.fn(),
      }
      const validator = new SeedphraseValidator(mockProvider)

      await validator.validate(
        '  ABANDON  abandon  ABANDON  abandon  abandon  abandon  abandon  abandon  abandon  abandon  abandon  ABOUT  '
      )

      expect(capturedMnemonic[0]).toBe(
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      )
    })

    it('should handle whitespace-only input', async () => {
      const mockProvider = createMockWasmProvider(() => false)
      const validator = new SeedphraseValidator(mockProvider)

      const result = await validator.validate('   \n\t   ')

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(0)
    })
  })
})
