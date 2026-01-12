/**
 * Seedphrase import module for Vultisig SDK
 *
 * This module provides functionality to import existing BIP39 seedphrases
 * into Vultisig vaults using the TSS (Threshold Signature Scheme) protocol.
 */

// Types
export type {
  ChainDiscoveryPhase,
  ChainDiscoveryProgress,
  ChainDiscoveryResult,
  DerivedMasterKeys,
  ImportSeedphraseAsFastVaultOptions,
  ImportSeedphraseAsSecureVaultOptions,
  SeedphraseImportResult,
  SeedphraseValidation,
  SeedphraseWordCount,
} from './types'
export { SEEDPHRASE_WORD_COUNTS } from './types'

// Validator
export { cleanMnemonic, SeedphraseValidator, validateSeedphrase } from './SeedphraseValidator'

// Key Deriver
export { type DerivedChainKey, MasterKeyDeriver } from './MasterKeyDeriver'

// Chain Discovery
export { type ChainDiscoveryConfig, ChainDiscoveryService } from './ChainDiscoveryService'
