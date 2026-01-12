/**
 * Integration Tests: Seedphrase Validation
 *
 * Tests seedphrase validation with REAL WalletCore WASM.
 * Verifies BIP39 mnemonic handling matches the standard.
 *
 * NOTE: Integration setup (WASM & crypto polyfills) loaded via vitest.config.ts
 */

import { beforeAll,describe, expect, it } from 'vitest'

import { createSdkContext, type SdkContext } from '../../../src/context/SdkContextBuilder'
import { SeedphraseValidator } from '../../../src/seedphrase/SeedphraseValidator'
import { SEEDPHRASE_WORD_COUNTS } from '../../../src/seedphrase/types'
import { MemoryStorage } from '../../../src/storage/MemoryStorage'

describe('Seedphrase Validation (Real WASM)', () => {
  let context: SdkContext
  let validator: SeedphraseValidator

  beforeAll(async () => {
    // Create SDK context with real WASM
    context = await createSdkContext({
      storage: new MemoryStorage(),
    })
    validator = new SeedphraseValidator(context.wasmProvider)

    // Pre-initialize WASM
    await context.wasmProvider.getWalletCore()
  })

  describe('valid mnemonics', () => {
    it('should validate standard 12-word test mnemonic', async () => {
      // BIP39 standard test vector
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
      expect(result.error).toBeUndefined()
    })

    it('should validate 24-word mnemonic', async () => {
      // Valid 24-word mnemonic
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(24)
    })

    it('should validate real-world style mnemonic', async () => {
      // A more realistic-looking mnemonic
      const mnemonic = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
      expect(result.wordCount).toBe(12)
    })
  })

  describe('invalid mnemonics', () => {
    it('should reject mnemonic with invalid checksum', async () => {
      // Same words but wrong checksum word
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      // Error message can be "Invalid mnemonic (checksum failed)" or contain invalid words info
      expect(result.error).toBeTruthy()
    })

    it('should reject mnemonic with non-BIP39 words', async () => {
      const mnemonic = 'hello world test invalid notaword abandon abandon abandon abandon abandon abandon about'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
    })

    it('should reject 11-word mnemonic', async () => {
      const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(11)
      expect(result.error).toContain('12 or 24')
    })

    it('should reject 13-word mnemonic', async () => {
      const mnemonic =
        'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(false)
      expect(result.wordCount).toBe(13)
    })

    it('should reject empty mnemonic', async () => {
      const result = await validator.validate('')
      expect(result.valid).toBe(false)
    })
  })

  describe('input normalization', () => {
    it('should handle uppercase input', async () => {
      const mnemonic = 'ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABANDON ABOUT'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
    })

    it('should handle mixed case input', async () => {
      const mnemonic = 'Abandon ABANDON abandon Abandon ABANDON abandon Abandon ABANDON abandon Abandon ABANDON About'
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
    })

    it('should handle extra whitespace', async () => {
      const mnemonic =
        '  abandon   abandon   abandon   abandon   abandon   abandon   abandon   abandon   abandon   abandon   abandon   about  '
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
    })

    it('should handle newlines and tabs', async () => {
      const mnemonic = `abandon\nabandon\tabandon
abandon abandon abandon
abandon abandon abandon
abandon abandon about`
      const result = await validator.validate(mnemonic)

      expect(result.valid).toBe(true)
    })
  })

  describe('word count constants', () => {
    it('should only support 12 and 24 word counts', () => {
      expect(SEEDPHRASE_WORD_COUNTS).toEqual([12, 24])
    })
  })
})
