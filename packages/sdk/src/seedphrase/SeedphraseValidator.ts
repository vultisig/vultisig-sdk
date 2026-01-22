/**
 * SeedphraseValidator - Validates BIP39 mnemonics with multi-language support
 *
 * Supports all 10 BIP39 languages: English, Japanese, Korean, Spanish,
 * Chinese (Simplified/Traditional), French, Italian, Czech, Portuguese.
 *
 * Adapted from vultisig-windows: core/ui/vault/import/seedphrase/utils/validateMnemonic.ts
 */
import { validateMnemonic } from '@scure/bip39'

import type { WasmProvider } from '../context/SdkContext'
import {
  BIP39_WORDLISTS,
  detectMnemonicLanguage,
  findInvalidWords,
  findInvalidWordsAcrossAllLanguages,
  getWordlist,
  normalizeMnemonic,
} from './languageDetection'
import {
  type Bip39Language,
  SEEDPHRASE_WORD_COUNTS,
  type SeedphraseValidation,
  type SeedphraseValidationOptions,
} from './types'

/**
 * Clean and normalize a mnemonic string
 *
 * Handles Unicode normalization, Japanese ideographic spaces, and whitespace.
 * This is an alias for normalizeMnemonic for backward compatibility.
 *
 * @param text - Raw mnemonic input
 * @returns Cleaned mnemonic with single spaces between words
 */
export const cleanMnemonic = normalizeMnemonic

/**
 * SeedphraseValidator - Validates BIP39 mnemonics with multi-language support
 *
 * Uses @scure/bip39 for validation with support for all 10 BIP39 languages.
 * Can auto-detect language or validate against a specific language.
 *
 * @example
 * ```typescript
 * const validator = new SeedphraseValidator(wasmProvider)
 *
 * // Auto-detect language
 * const result = await validator.validate('abandon abandon ... about')
 * console.log(result.detectedLanguage) // 'english'
 *
 * // Specify language explicitly
 * const jpResult = await validator.validate(japaneseMnemonic, { language: 'japanese' })
 * ```
 */
export class SeedphraseValidator {
  constructor(private readonly wasmProvider: WasmProvider) {}

  /**
   * Validate a mnemonic phrase
   *
   * @param mnemonic - The mnemonic to validate (space-separated words)
   * @param options - Validation options (language, etc.)
   * @returns Validation result with details including detected language
   */
  async validate(mnemonic: string, options?: SeedphraseValidationOptions): Promise<SeedphraseValidation> {
    const normalized = normalizeMnemonic(mnemonic)

    // Empty input is invalid
    if (normalized === '') {
      return {
        valid: false,
        wordCount: 0,
        error: 'Mnemonic is empty',
      }
    }

    const words = normalized.split(' ')
    const wordCount = words.length

    // Check word count (must be 12 or 24)
    if (!SEEDPHRASE_WORD_COUNTS.includes(wordCount as 12 | 24)) {
      return {
        valid: false,
        wordCount,
        error: `Mnemonic must be 12 or 24 words, got ${wordCount}`,
      }
    }

    // Determine language to use
    let language: Bip39Language | null = options?.language ?? null

    if (!language) {
      // Auto-detect language
      language = detectMnemonicLanguage(normalized)

      if (!language) {
        // No language matched - find invalid words across all wordlists
        const invalidWords = findInvalidWordsAcrossAllLanguages(normalized)
        return {
          valid: false,
          wordCount,
          invalidWords: invalidWords.length > 0 ? invalidWords : undefined,
          error:
            invalidWords.length > 0
              ? `Invalid words: ${invalidWords.join(', ')}`
              : 'Invalid mnemonic - no matching BIP39 language',
        }
      }
    } else {
      // Explicit language specified - validate with that language
      const wordlist = getWordlist(language)
      const isValid = validateMnemonic(normalized, wordlist)

      if (!isValid) {
        const invalidWords = findInvalidWords(normalized, language)
        return {
          valid: false,
          wordCount,
          detectedLanguage: language,
          invalidWords: invalidWords.length > 0 ? invalidWords : undefined,
          error:
            invalidWords.length > 0
              ? `Invalid words for ${language}: ${invalidWords.join(', ')}`
              : 'Invalid mnemonic (checksum failed)',
        }
      }

      return {
        valid: true,
        wordCount: wordCount as 12 | 24,
        detectedLanguage: language,
      }
    }

    // Language was auto-detected and is valid
    return {
      valid: true,
      wordCount: wordCount as 12 | 24,
      detectedLanguage: language,
    }
  }

  /**
   * Get word suggestions for autocomplete
   *
   * @param prefix - The prefix to search for
   * @param language - The language wordlist to search (defaults to english)
   * @param limit - Maximum number of suggestions to return (defaults to 10)
   * @returns Array of matching words
   */
  getSuggestions(prefix: string, language: Bip39Language = 'english', limit = 10): string[] {
    const wordlist = BIP39_WORDLISTS[language]
    const normalizedPrefix = prefix.toLowerCase().trim()
    return wordlist.filter(word => word.startsWith(normalizedPrefix)).slice(0, limit)
  }
}

/**
 * Standalone validation function for quick validation without instantiating a class
 *
 * @param mnemonic - The mnemonic to validate
 * @param wasmProvider - WASM provider for WalletCore access
 * @param options - Validation options (language, etc.)
 * @returns Validation result
 */
export async function validateSeedphrase(
  mnemonic: string,
  wasmProvider: WasmProvider,
  options?: SeedphraseValidationOptions
): Promise<SeedphraseValidation> {
  const validator = new SeedphraseValidator(wasmProvider)
  return validator.validate(mnemonic, options)
}
