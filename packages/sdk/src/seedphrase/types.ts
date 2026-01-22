/**
 * Seedphrase types for Vultisig SDK
 * Used for creating vaults from existing seedphrases
 */
import type { Chain } from '@core/chain/Chain'

import type { VaultCreationStep } from '../types'

/**
 * Supported BIP39 mnemonic languages
 */
export const BIP39_LANGUAGES = [
  'english',
  'japanese',
  'korean',
  'spanish',
  'chinese_simplified',
  'chinese_traditional',
  'french',
  'italian',
  'czech',
  'portuguese',
] as const

export type Bip39Language = (typeof BIP39_LANGUAGES)[number]

/**
 * Options for seedphrase validation
 */
export type SeedphraseValidationOptions = {
  /** Explicit language to validate against. If not provided, auto-detects. */
  language?: Bip39Language
}

/**
 * Result of seedphrase validation
 */
export type SeedphraseValidation = {
  /** Whether the seedphrase is valid */
  valid: boolean
  /** Number of words in the seedphrase */
  wordCount: 12 | 24 | number
  /** Words that are not in the BIP39 wordlist (if any) */
  invalidWords?: string[]
  /** Error message if validation failed */
  error?: string
  /** Detected or specified language of the mnemonic */
  detectedLanguage?: Bip39Language
}

/**
 * Supported seedphrase word counts
 */
export const SEEDPHRASE_WORD_COUNTS = [12, 24] as const
export type SeedphraseWordCount = (typeof SEEDPHRASE_WORD_COUNTS)[number]

/**
 * Progress phases for chain discovery
 */
export type ChainDiscoveryPhase = 'validating' | 'deriving' | 'fetching' | 'complete'

/**
 * Progress update during chain discovery
 */
export type ChainDiscoveryProgress = {
  /** Current phase of discovery */
  phase: ChainDiscoveryPhase
  /** Chain currently being processed */
  chain?: Chain
  /** Number of chains processed so far */
  chainsProcessed: number
  /** Total number of chains to process */
  chainsTotal: number
  /** Chains found to have non-zero balance */
  chainsWithBalance: Chain[]
  /** Human-readable progress message */
  message: string
}

/**
 * Result for a single chain during discovery
 */
export type ChainDiscoveryResult = {
  /** The blockchain chain */
  chain: Chain
  /** Derived address for this chain */
  address: string
  /** Balance amount (as string for precision) */
  balance: string
  /** Token decimals */
  decimals: number
  /** Token symbol (e.g., 'BTC', 'ETH') */
  symbol: string
  /** Whether this chain has a non-zero balance */
  hasBalance: boolean
}

/**
 * Options for creating a FastVault from a seedphrase (2-of-2 with VultiServer)
 */
export type CreateFastVaultFromSeedphraseOptions = {
  /** The mnemonic phrase (12 or 24 words, space-separated) */
  mnemonic: string
  /** Name for the new vault */
  name: string
  /** Password for vault encryption (required for FastVault) */
  password: string
  /** Email for VultiServer registration and verification */
  email: string
  /** Specific chains to enable (defaults to discovered chains or DEFAULT_CHAINS) */
  chains?: Chain[]
  /** Whether to scan for chains with existing balances */
  discoverChains?: boolean
  /** Chains to scan during discovery (defaults to all supported) */
  chainsToScan?: Chain[]
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback for vault creation steps */
  onProgress?: (step: VaultCreationStep) => void
  /** Progress callback for chain discovery */
  onChainDiscovery?: (progress: ChainDiscoveryProgress) => void
}

/**
 * Options for creating a SecureVault from a seedphrase (N-of-M multi-device)
 */
export type CreateSecureVaultFromSeedphraseOptions = {
  /** The mnemonic phrase (12 or 24 words, space-separated) */
  mnemonic: string
  /** Name for the new vault */
  name: string
  /** Optional password for vault encryption */
  password?: string
  /** Number of devices participating in the vault (minimum 2) */
  devices: number
  /** Signing threshold (defaults to 2/3 majority) */
  threshold?: number
  /** Specific chains to enable */
  chains?: Chain[]
  /** Whether to scan for chains with existing balances */
  discoverChains?: boolean
  /** Chains to scan during discovery */
  chainsToScan?: Chain[]
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback for vault creation steps */
  onProgress?: (step: VaultCreationStep) => void
  /** Callback when QR code is ready for mobile pairing */
  onQRCodeReady?: (qrPayload: string) => void
  /** Callback when a device joins the session */
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
  /** Progress callback for chain discovery */
  onChainDiscovery?: (progress: ChainDiscoveryProgress) => void
}

/**
 * Options for joining an existing SecureVault creation session as a non-initiator device.
 * Works for both fresh keygen and seedphrase-based vaults (auto-detected from QR).
 */
export type JoinSecureVaultOptions = {
  /**
   * The mnemonic phrase (required for seedphrase-based vaults, ignored for keygen).
   * Must match the initiator's seedphrase when joining a from-seedphrase session.
   */
  mnemonic?: string
  /** Optional password for vault encryption */
  password?: string
  /** Number of devices participating in the vault (required) */
  devices: number
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback for vault creation steps */
  onProgress?: (step: VaultCreationStep) => void
  /** Callback when a device joins the session */
  onDeviceJoined?: (deviceId: string, totalJoined: number, required: number) => void
}

/**
 * Result of a seedphrase import operation
 */
export type SeedphraseImportResult = {
  /** ID of the created vault (ECDSA public key) */
  vaultId: string
  /** Whether email verification is required (FastVault only) */
  verificationRequired?: boolean
  /** Session ID for multi-device coordination (SecureVault only) */
  sessionId?: string
  /** Chains discovered with balances (if discoverChains was enabled) */
  discoveredChains?: ChainDiscoveryResult[]
}

/**
 * Master keys derived from a seedphrase
 * Used internally during the import process
 */
export type DerivedMasterKeys = {
  /** ECDSA private key (secp256k1) as hex string */
  ecdsaPrivateKeyHex: string
  /** EdDSA private key (ed25519, after clamping) as hex string */
  eddsaPrivateKeyHex: string
  /** BIP32 chain code as hex string */
  chainCodeHex: string
}
