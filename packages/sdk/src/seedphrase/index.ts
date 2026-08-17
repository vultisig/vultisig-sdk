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
  ChainDiscoveryAggregate,
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
export { type ChainDiscoveryConfig, ChainDiscoveryService, TransportError } from './ChainDiscoveryService'

// Chain support policy
export {
  assertSeedphraseImportSupportsChains,
  getUnsupportedSeedphraseImportChains,
  isSeedphraseImportSupportedChain,
  SEEDPHRASE_IMPORT_SUPPORTED_CHAINS,
  SEEDPHRASE_IMPORT_UNSUPPORTED_CHAINS,
} from '../constants'

// Shared prelude for both seedphrase-import paths (fast + secure). It is the
// step a caller has to run before either service, so leaving it internal meant
// the public API described a flow whose first step could not be reached.
export {
  prepareSeedphraseImportPrelude,
  type SeedphraseImportPreludeInput,
  type SeedphraseImportPreludeProgressLabels,
  type SeedphraseImportPreludeResult,
} from './prepareSeedphraseImportPrelude'
