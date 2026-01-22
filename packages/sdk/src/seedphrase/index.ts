/**
 * Seedphrase module for Vultisig SDK
 *
 * This module provides functionality to create Vultisig vaults from
 * existing BIP39 seedphrases using the TSS (Threshold Signature Scheme) protocol.
 *
 * Supports all 10 BIP39 languages: English, Japanese, Korean, Spanish,
 * Chinese (Simplified/Traditional), French, Italian, Czech, Portuguese.
 */

// Types
export type {
  Bip39Language,
  ChainDiscoveryPhase,
  ChainDiscoveryProgress,
  ChainDiscoveryResult,
  CreateFastVaultFromSeedphraseOptions,
  CreateSecureVaultFromSeedphraseOptions,
  DerivedMasterKeys,
  JoinSecureVaultOptions,
  SeedphraseImportResult,
  SeedphraseValidation,
  SeedphraseValidationOptions,
  SeedphraseWordCount,
} from './types'
export { BIP39_LANGUAGES, SEEDPHRASE_WORD_COUNTS } from './types'

// Language detection utilities
export {
  BIP39_WORDLISTS,
  detectMnemonicLanguage,
  findInvalidWords,
  findInvalidWordsAcrossAllLanguages,
  getWordlist,
  normalizeMnemonic,
} from './languageDetection'

// Validator
export { cleanMnemonic, SeedphraseValidator, validateSeedphrase } from './SeedphraseValidator'

// Key Deriver
export { type DerivedChainKey, MasterKeyDeriver } from './MasterKeyDeriver'

// Chain Discovery
export { type ChainDiscoveryConfig, ChainDiscoveryService } from './ChainDiscoveryService'
