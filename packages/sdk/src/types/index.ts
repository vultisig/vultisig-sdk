/**
 * Core types for VultisigSDK
 * Re-exports and extends types from core packages
 */

// Re-export core types from their actual locations
export type { ChainKind } from '@core/chain/ChainKind'
export type { AccountCoin } from '@core/chain/coin/AccountCoin'
export type { Coin } from '@core/chain/coin/Coin'
export type { PublicKeys } from '@core/chain/publicKey/PublicKeys'
export type { FiatCurrency } from '@core/config/FiatCurrency'
export type { MpcServerType } from '@core/mpc/MpcServerType'
export type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
export { KeysignPayloadSchema } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
export type { VaultKeyShares } from '@core/mpc/vault/Vault'

// Import MpcLib for use in VaultData type
import type { MpcLib } from '@core/mpc/mpcLib'
export type { MpcLib }

// Import and export Chain types
import type { CosmosChain, EvmChain, OtherChain, UtxoChain } from '@core/chain/Chain'
export type { Chain as ChainType } from '@core/chain/Chain'
export { Chain } from '@core/chain/Chain'

// VaultFolder and VaultSecurityType not available in copied core - using local types
export type VaultFolder = 'fast' | 'secure'
export type VaultSecurityType = 'fast' | 'secure'

// SDK-specific types
export type VaultOptions = {
  name: string
  threshold: number
  participants: string[]
  email?: string
  password?: string
  serverAssisted?: boolean
}

export type VaultBackup = {
  data: ArrayBuffer | string
  format: 'DKLS'
  encrypted: boolean
}

export type VaultDetails = {
  name: string
  id: string
  securityType: 'fast' | 'secure'
  threshold: number
  participants: number
  chains: Array<'evm' | 'utxo' | 'cosmos' | 'solana' | 'sui' | 'polkadot' | 'ton' | 'ripple' | 'tron' | 'cardano'>
  createdAt?: number
  isBackedUp: boolean
}

export type ValidationResult = {
  valid: boolean
  error?: string
}

export type VaultValidationResult = {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export type ExportOptions = {
  password?: string
  format?: 'dat' | 'vult'
  includeMetadata?: boolean
}

export type Balance = {
  amount: string
  formattedAmount: string
  decimals: number
  symbol: string
  chainId: string
  tokenId?: string
  value?: number
  fiatValue?: number
  fiatCurrency?: string
}

export type MaxSendAmount = {
  /** Balance in base units (e.g., wei) */
  balance: bigint
  /** Estimated network fee in base units */
  fee: bigint
  /** Maximum sendable amount (balance - fee) */
  maxSendable: bigint
}

export type CachedBalance = {
  balance: Balance
  cachedAt: number // Unix timestamp when cached
  ttl: number // Time to live in milliseconds (5 minutes = 300000)
}

/**
 * Fiat value representation
 * Used for portfolio values and individual asset values
 */
export type Value = {
  /** Formatted value amount (e.g., "1234.56") */
  amount: string
  /** Currency code (e.g., "USD", "EUR", "GBP") */
  currency: string
  /** Unix timestamp of when value was calculated */
  lastUpdated: number
}

export type SigningMode = 'fast' | 'relay' | 'local'

export type SigningPayload = {
  transaction: any // Chain-specific transaction data
  chain: any
  derivePath?: string
  messageHashes?: string[] // Pre-computed message hashes for signing
}

/**
 * Input format for signBytes - accepts raw bytes or hex string
 */
export type BytesInput = Uint8Array | Buffer | string

/**
 * Options for the signBytes method
 */
export type SignBytesOptions = {
  /**
   * The pre-hashed data to sign.
   * - If Uint8Array or Buffer: used directly as raw bytes
   * - If string: interpreted as hex-encoded bytes (with or without 0x prefix)
   */
  data: BytesInput

  /**
   * Chain to sign for. Used to determine:
   * - Signature algorithm (ECDSA for EVM/UTXO, EdDSA for Solana/Sui)
   * - Derivation path (chain-specific BIP-44 path)
   */
  chain: Chain
}

/**
 * Parameters for broadcasting a pre-signed raw transaction
 */
export type BroadcastRawTxParams = {
  /**
   * Target blockchain to broadcast on
   */
  chain: Chain

  /**
   * Hex-encoded signed transaction (with or without 0x prefix)
   */
  rawTx: string
}

export type Signature = {
  signature: string
  recovery?: number
  format: 'DER' | 'ECDSA' | 'EdDSA' | 'Ed25519'
  // For UTXO chains with multiple inputs, includes all signatures
  signatures?: Array<{
    r: string
    s: string
    der: string
  }>
}

export type FastSigningInput = {
  publicKey: string
  messages: string[] // hex-encoded message hashes
  session: string
  hexEncryptionKey: string
  derivePath: string
  isEcdsa: boolean
  vaultPassword: string
}

export type ReshareOptions = {
  newThreshold: number
  newParticipants: string[]
  removeParticipants?: string[]
}

export type ServerStatus = {
  fastVault: {
    online: boolean
    latency?: number
  }
  messageRelay: {
    online: boolean
    latency?: number
  }
  timestamp: number
}

// Keygen progress types
export type KeygenPhase = 'prepare' | 'ecdsa' | 'eddsa' | 'complete'

export type KeygenProgressUpdate = {
  phase: KeygenPhase
  round?: number
  message?: string
}

export type SDKConfig = {
  serverEndpoints?: {
    fastVault?: string
    messageRelay?: string
  }
}

import type { Chain } from '@core/chain/Chain'

// Cache types
export type { CacheConfig, CacheScope } from '../services/cache-types'

// Extended SDK config with connection options and defaults
export type VultisigConfig = SDKConfig & {
  /**
   * Storage configuration options
   * Configures the global storage used by all vaults and managers
   * @see GlobalStorage.configure()
   */
  storage?: import('../storage/types').Storage
  autoInit?: boolean
  autoConnect?: boolean
  defaultChains?: Chain[]
  defaultCurrency?: string
  cacheConfig?: import('../services/cache-types').CacheConfig

  /**
   * Password cache configuration
   */
  passwordCache?: {
    /**
     * Time to live for cached passwords in milliseconds
     * - Set to 0 to disable caching (prompt every time)
     * - Set to positive number for cache duration
     * @default 300000 (5 minutes)
     */
    defaultTTL?: number
  }

  /**
   * Callback function to prompt user for password when required
   * Called when:
   * - Operation requires password for encrypted vault
   * - Password not in cache
   * - Password not provided as parameter
   *
   * @param vaultId - ID of vault requiring password
   * @param vaultName - Name of vault requiring password
   * @returns Promise resolving to password string
   * @throws If user cancels or prompt fails
   *
   * @example
   * // React implementation
   * onPasswordRequired: async (vaultId, vaultName) => {
   *   const password = await showPasswordModal(vaultName);
   *   if (!password) throw new Error('Password required');
   *   return password;
   * }
   *
   * @example
   * // CLI implementation
   * onPasswordRequired: async (vaultId, vaultName) => {
   *   return await promptForPassword(`Enter password for ${vaultName}: `);
   * }
   */
  onPasswordRequired?: (vaultId: string, vaultName: string) => Promise<string>
}

// Connection options
export type ConnectionOptions = {
  vaultId?: string
  password?: string
}

// Convenience wrapper parameter types
export type SignTransactionParams = {
  chain: Chain
  payload: SigningPayload
  password?: string
  mode?: SigningMode
}

export type SignMessageParams = {
  chain: Chain
  message: string
  password?: string
}

export type SignTypedDataParams = {
  chain: Chain
  typedData: Record<string, unknown>
  password?: string
}

export type GetBalanceParams = {
  chain: Chain
  tokenId?: string
}

export type CreateVaultOptions = {
  name: string
  type?: VaultType
  password?: string
  email?: string
  onProgress?: (step: VaultCreationStep) => void
}

export type VaultSummary = {
  id: string
  name: string
  type: VaultType
  createdAt: number
  isEncrypted: boolean
}

// Address derivation types
export type ChainConfig = {
  name: string
  symbol: string
  derivationPath: string
  addressFormat: 'legacy' | 'segwit' | 'bech32' | 'ethereum'
  network?: 'mainnet' | 'testnet'
}

export type AddressResult = {
  address: string
  chain: string
  derivationTime: number
  cached: boolean
}

// VaultManager types
export type VaultType = 'fast' | 'secure'
export type KeygenMode = 'fast' | 'relay' | 'local'

/**
 * @internal
 * Internal configuration for VaultManager - not part of public API
 */
export type VaultManagerConfig = {
  defaultChains: Chain[]
  defaultCurrency: string
}

export type VaultCreationStep = {
  step: 'initializing' | 'keygen' | 'deriving_addresses' | 'fetching_balances' | 'applying_tokens' | 'complete'
  progress: number
  message: string
  chainId?: string
}

export type SigningStep = {
  step: 'preparing' | 'coordinating' | 'signing' | 'broadcasting' | 'complete'
  progress: number
  message: string
  mode: SigningMode
  participantCount?: number
  participantsReady?: number
}

/**
 * Standard progress callback type for long-running operations
 * Used for signing, vault creation, and other long-running operations
 *
 * Note: For cancellation, use AbortSignal instead of return values
 */
export type OnProgressCallback = (step: SigningStep) => void

export type AddressBookEntry = {
  chain: Chain
  address: string
  name: string
  source: 'saved' | 'vault'
  vaultId?: string
  vaultName?: string
  dateAdded: number
}

export type AddressBook = {
  saved: AddressBookEntry[]
  vaults: AddressBookEntry[]
}

export type Token = {
  id: string
  symbol: string
  name: string
  decimals: number
  contractAddress?: string
  chainId: string
  logoUrl?: string
  isNative?: boolean
}

/**
 * VaultData - Clean, focused vault state
 * Replaces the old VaultData and Summary types
 *
 * This is the single source of truth for vault data in the SDK.
 * It combines immutable vault identity with mutable user preferences.
 *
 * ## Structure
 *
 * The type is organized into four logical groups:
 *
 * 1. **Identity** - Immutable cryptographic identity (readonly)
 *    - Public keys, signers, chain code
 *    - Never changes after vault creation
 *
 * 2. **Metadata** - Vault metadata (some readonly, some mutable)
 *    - ID, name, type, backup status
 *    - Some fields can be changed by user
 *
 * 3. **Preferences** - User preferences (all mutable)
 *    - Currency, chains, tokens
 *    - Fully customizable by user
 *
 * 4. **Vault File** - Raw vault backup (readonly)
 *    - Base64 encoded .vult file
 *    - Regenerated on export with current metadata
 *
 * ## Readonly Fields
 *
 * Fields marked `readonly` represent immutable vault characteristics.
 * These cannot be changed without creating a new vault.
 *
 * ## Storage
 *
 * VaultData is stored at: `vault:{id}`
 * Persistent cache is stored at: `vault:{id}:cache`
 *
 * @example
 * ```typescript
 * // Access vault data
 * const vault = await vaultManager.getVaultById(0)
 * console.log(vault.name)              // Direct getter
 * console.log(vault.data)              // Full VaultData object
 * console.log(vault.threshold)         // Computed getter
 * ```
 */
export type VaultData = {
  // === Identity (immutable, from .vult file) ===
  // These fields define the cryptographic identity of the vault
  // and NEVER change after vault creation
  readonly publicKeys: Readonly<{ ecdsa: string; eddsa: string }>
  readonly hexChainCode: string
  readonly signers: readonly string[] // Simple string array, readonly
  readonly localPartyId: string
  readonly createdAt: number
  readonly libType: MpcLib
  readonly isEncrypted: boolean // Immutable - whether .vult file needs password
  readonly type: 'fast' | 'secure' // Immutable - computed from signers

  // === Metadata (SDK-managed) ===
  readonly id: string // Immutable - ECDSA public key (storage key)
  name: string // Mutable - user can rename vault
  isBackedUp: boolean // Mutable - user can toggle backup status
  order: number // Mutable - user can reorder vaults
  folderId?: string // Mutable - user can move to different folder
  lastModified: number // Mutable - updated on every change

  // === User Preferences (mutable, SDK-managed) ===
  currency: string // Mutable - user's preferred fiat currency
  chains: string[] // Mutable - user's active blockchain chains
  tokens: Record<string, Token[]> // Mutable - user's custom tokens per chain
  lastValueUpdate?: number // Mutable - last portfolio value calculation

  // === Chain-specific keys (for seedphrase imports) ===
  readonly chainPublicKeys?: Partial<Record<string, string>>
  readonly chainKeyShares?: Partial<Record<string, string>>

  // === Raw Vault File (immutable after load) ===
  readonly vultFileContent: string // Set once at import/creation, regenerated on export
}

/**
 * Helper type to make all readonly fields mutable
 * Used internally when we need to update readonly fields
 */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends readonly (infer U)[] ? U[] : T[P] extends Readonly<infer O> ? O : T[P]
}

// Base properties shared by all gas info
type BaseGasInfo = {
  chainId: string
  gasPrice: string
  estimatedCost?: bigint
  estimatedCostUSD?: number
  lastUpdated: number
}

/**
 * EVM chains gas info (Ethereum, Polygon, BSC, Arbitrum, Optimism, Base, etc.)
 * Includes EIP-1559 fee structure with gas limit and priority fees
 */
export type EvmGasInfo = BaseGasInfo & {
  gasPriceGwei: string
  priorityFee: string
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  gasLimit: bigint
}

/**
 * UTXO chains gas info (Bitcoin, Litecoin, Dogecoin, Dash, etc.)
 * Uses byte-based fee calculation
 */
export type UtxoGasInfo = BaseGasInfo & {
  byteFee?: string
}

/**
 * Cosmos chains gas info (Cosmos, Osmosis, THORChain, MayaChain, Dydx, etc.)
 * Uses gas-based fee calculation
 */
export type CosmosGasInfo = BaseGasInfo & {
  gas?: string
}

/**
 * Other chains gas info (Solana, Polkadot, Sui, TON, Tron, Ripple, Cardano)
 * Each chain may have its own fee structure
 */
export type OtherGasInfo = BaseGasInfo & {
  priorityFee?: string
}

/**
 * Conditional type that returns the correct GasInfo based on chain type.
 * Enables perfect type safety with template literal types.
 *
 * @example
 * const ethGas = await vault.gas(Chain.Ethereum) // Type: EvmGasInfo
 * console.log(ethGas.gasLimit) // ✅ TypeScript knows this exists
 *
 * const btcGas = await vault.gas(Chain.Bitcoin) // Type: UtxoGasInfo
 * console.log(btcGas.gasLimit) // ❌ TypeScript error - doesn't exist on UTXO
 */
export type GasInfoForChain<C extends string> = C extends EvmChain
  ? EvmGasInfo
  : C extends UtxoChain
    ? UtxoGasInfo
    : C extends CosmosChain
      ? CosmosGasInfo
      : C extends OtherChain
        ? OtherGasInfo
        : BaseGasInfo

/**
 * Union type for gas info across all chains.
 * Use this when the chain type is not known at compile time.
 */
export type GasInfo = EvmGasInfo | UtxoGasInfo | CosmosGasInfo | OtherGasInfo

export type GasEstimate = {
  gasLimit: number
  gasPrice: string
  totalCost: {
    baseToken: string
    usd: string
    symbol: string
  }
  breakdown?: {
    gasLimit: number
    gasPrice: string
    priorityFee?: string
    maxFeePerGas?: string
  }
  chainId: string
}

// Solana-specific types (now handled by core)
// Removed - using core types directly instead of SDK wrappers

// Swap types
export type {
  CoinInput,
  GeneralSwapProvider,
  GeneralSwapQuote,
  NativeSwapQuote,
  SimpleCoinInput,
  SwapApprovalInfo,
  SwapFees,
  SwapPrepareResult,
  SwapQuote,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapTxParams,
} from '../vault/swap-types'
export { isAccountCoin, isSimpleCoinInput } from '../vault/swap-types'

// Cosmos signing types
export type {
  CosmosCoinAmount,
  CosmosFeeInput,
  CosmosMsgInput,
  CosmosSigningOptions,
  SignAminoInput,
  SignDirectInput,
} from './cosmos'

// Token registry & chain data types
export type { CoinPricesParams, CoinPricesResult, DiscoveredToken, FeeCoinInfo, TokenInfo } from './tokens'

// Security scanning types
export type { RiskLevel, SiteScanResult, TransactionSimulationResult, TransactionValidationResult } from './security'

// Cosmos message type constants
export type { CosmosMsgType as CosmosMsgTypeValue } from './cosmos-msg'
export { CosmosMsgType } from './cosmos-msg'
