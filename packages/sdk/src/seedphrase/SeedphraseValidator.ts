/**
 * SeedphraseValidator - Validates BIP39 mnemonics using WalletCore
 *
 * Adapted from vultisig-windows: core/ui/vault/import/seedphrase/utils/validateMnemonic.ts
 */
import type { WasmProvider } from '../context/SdkContext'
import { SEEDPHRASE_WORD_COUNTS, type SeedphraseValidation } from './types'

/**
 * Clean and normalize a mnemonic string
 * Removes extra whitespace and normalizes to single spaces
 *
 * @param text - Raw mnemonic input
 * @returns Cleaned mnemonic with single spaces between words
 */
export const cleanMnemonic = (text: string): string => text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(' ')

/**
 * SeedphraseValidator - Validates BIP39 mnemonics
 *
 * Uses WalletCore's Mnemonic.isValid() for full BIP39 validation including:
 * - Word count (12 or 24 words)
 * - BIP39 wordlist validation
 * - Checksum verification
 *
 * @example
 * ```typescript
 * const validator = new SeedphraseValidator(wasmProvider)
 * const result = await validator.validate('abandon abandon ... about')
 * if (result.valid) {
 *   console.log(`Valid ${result.wordCount}-word mnemonic`)
 * } else {
 *   console.error(`Invalid: ${result.error}`)
 * }
 * ```
 */
export class SeedphraseValidator {
  constructor(private readonly wasmProvider: WasmProvider) {}

  /**
   * Validate a mnemonic phrase
   *
   * @param mnemonic - The mnemonic to validate (space-separated words)
   * @returns Validation result with details
   */
  async validate(mnemonic: string): Promise<SeedphraseValidation> {
    const cleaned = cleanMnemonic(mnemonic)

    // Empty input is invalid
    if (cleaned === '') {
      return {
        valid: false,
        wordCount: 0,
        error: 'Mnemonic is empty',
      }
    }

    const words = cleaned.split(' ')
    const wordCount = words.length

    // Check word count (must be 12 or 24)
    if (!SEEDPHRASE_WORD_COUNTS.includes(wordCount as 12 | 24)) {
      return {
        valid: false,
        wordCount,
        error: `Mnemonic must be 12 or 24 words, got ${wordCount}`,
      }
    }

    // Use WalletCore for full BIP39 validation
    const walletCore = await this.wasmProvider.getWalletCore()

    if (!walletCore.Mnemonic.isValid(cleaned)) {
      // Try to find invalid words for better error messages
      const invalidWords = await this.findInvalidWords(words, walletCore)

      return {
        valid: false,
        wordCount,
        invalidWords: invalidWords.length > 0 ? invalidWords : undefined,
        error:
          invalidWords.length > 0 ? `Invalid words: ${invalidWords.join(', ')}` : 'Invalid mnemonic (checksum failed)',
      }
    }

    return {
      valid: true,
      wordCount: wordCount as 12 | 24,
    }
  }

  /**
   * Find words that are not in the BIP39 wordlist
   *
   * @param words - Array of words to check
   * @param walletCore - WalletCore instance
   * @returns Array of invalid words
   */
  private async findInvalidWords(words: string[], walletCore: any): Promise<string[]> {
    const invalidWords: string[] = []

    for (const word of words) {
      // WalletCore.Mnemonic.isValidWord checks if a word is in the BIP39 wordlist
      if (walletCore.Mnemonic.isValidWord && !walletCore.Mnemonic.isValidWord(word)) {
        invalidWords.push(word)
      }
    }

    return invalidWords
  }
}

/**
 * Standalone validation function for quick validation without instantiating a class
 *
 * @param mnemonic - The mnemonic to validate
 * @param wasmProvider - WASM provider for WalletCore access
 * @returns Validation result
 */
export async function validateSeedphrase(mnemonic: string, wasmProvider: WasmProvider): Promise<SeedphraseValidation> {
  const validator = new SeedphraseValidator(wasmProvider)
  return validator.validate(mnemonic)
}
