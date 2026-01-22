/**
 * BIP39 Language Detection Utilities
 *
 * Provides multi-language support for BIP39 mnemonic validation.
 * Supports all 10 official BIP39 languages.
 */
import { validateMnemonic } from '@scure/bip39'
import { wordlist as czech } from '@scure/bip39/wordlists/czech'
import { wordlist as english } from '@scure/bip39/wordlists/english'
import { wordlist as french } from '@scure/bip39/wordlists/french'
import { wordlist as italian } from '@scure/bip39/wordlists/italian'
import { wordlist as japanese } from '@scure/bip39/wordlists/japanese'
import { wordlist as korean } from '@scure/bip39/wordlists/korean'
import { wordlist as portuguese } from '@scure/bip39/wordlists/portuguese'
import { wordlist as simplifiedChinese } from '@scure/bip39/wordlists/simplified-chinese'
import { wordlist as spanish } from '@scure/bip39/wordlists/spanish'
import { wordlist as traditionalChinese } from '@scure/bip39/wordlists/traditional-chinese'

import type { Bip39Language } from './types'

/**
 * Map of BIP39 languages to their wordlists
 */
export const BIP39_WORDLISTS: Record<Bip39Language, readonly string[]> = {
  english,
  japanese,
  korean,
  spanish,
  chinese_simplified: simplifiedChinese,
  chinese_traditional: traditionalChinese,
  french,
  italian,
  czech,
  portuguese,
}

/**
 * Normalize a mnemonic string for validation
 *
 * Handles:
 * - NFKD Unicode normalization (required for proper BIP39 handling)
 * - Japanese ideographic space (U+3000) conversion to ASCII space
 * - Whitespace normalization (multiple spaces, tabs, newlines)
 * - Lowercase conversion
 *
 * @param mnemonic - Raw mnemonic input
 * @returns Normalized mnemonic with single spaces between words
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic
    .normalize('NFKD') // Unicode normalization for proper BIP39 handling
    .trim()
    .toLowerCase()
    .replace(/[\u3000]/g, ' ') // Replace Japanese ideographic space with ASCII space
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/**
 * Detect the language of a BIP39 mnemonic
 *
 * Tries English first (most common), then other languages.
 * Returns the first language where the mnemonic validates successfully.
 *
 * @param mnemonic - The mnemonic to detect language for (will be normalized)
 * @returns The detected language, or null if no language matches
 */
export function detectMnemonicLanguage(mnemonic: string): Bip39Language | null {
  const normalized = normalizeMnemonic(mnemonic)

  // Try English first as it's most common
  if (validateMnemonic(normalized, BIP39_WORDLISTS.english)) {
    return 'english'
  }

  // Try other languages in order
  const otherLanguages: Bip39Language[] = [
    'japanese',
    'korean',
    'spanish',
    'chinese_simplified',
    'chinese_traditional',
    'french',
    'italian',
    'czech',
    'portuguese',
  ]

  for (const language of otherLanguages) {
    if (validateMnemonic(normalized, BIP39_WORDLISTS[language])) {
      return language
    }
  }

  return null
}

/**
 * Get the wordlist for a specific BIP39 language
 *
 * @param language - The BIP39 language
 * @returns The wordlist array for that language
 */
export function getWordlist(language: Bip39Language): readonly string[] {
  return BIP39_WORDLISTS[language]
}

/**
 * Find words in a mnemonic that are not in the specified language's wordlist
 *
 * @param mnemonic - The mnemonic to check (will be normalized)
 * @param language - The language to check against
 * @returns Array of words that are not in the wordlist
 */
export function findInvalidWords(mnemonic: string, language: Bip39Language): string[] {
  const normalized = normalizeMnemonic(mnemonic)
  if (normalized === '') {
    return []
  }

  const wordlist = BIP39_WORDLISTS[language]
  const wordlistSet = new Set(wordlist)
  const words = normalized.split(' ')

  return words.filter(word => !wordlistSet.has(word))
}

/**
 * Find words that don't appear in any BIP39 wordlist
 *
 * @param mnemonic - The mnemonic to check (will be normalized)
 * @returns Array of words that are not in any wordlist
 */
export function findInvalidWordsAcrossAllLanguages(mnemonic: string): string[] {
  const normalized = normalizeMnemonic(mnemonic)
  if (normalized === '') {
    return []
  }

  // Build a set of all words from all wordlists
  const allWords = new Set<string>()
  for (const wordlist of Object.values(BIP39_WORDLISTS)) {
    for (const word of wordlist) {
      allWords.add(word)
    }
  }

  const words = normalized.split(' ')
  return words.filter(word => !allWords.has(word))
}
