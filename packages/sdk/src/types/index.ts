/**
 * Core types for VultisigSDK
 * Re-exports and extends types from core packages
 */

// Re-export core types from their actual locations
export type { ChainKind } from '@core/chain/ChainKind'
export type { AccountCoin } from '@core/chain/coin/AccountCoin'
export type { Coin } from '@core/chain/coin/Coin'
export type { PublicKeys } from '@core/chain/publicKey/PublicKeys'
export type { MpcServerType } from '@core/mpc/MpcServerType'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'
export type { VaultKeyShares } from '@core/mpc/vault/Vault'

// Import and export Chain types
import type {
  CosmosChain,
  EvmChain,
  OtherChain,
  UtxoChain,
} from '@core/chain/Chain'
export type { Chain as ChainType } from '@core/chain/Chain'
export { Chain } from '@core/chain/Chain'

// SDK-extended vault type that includes calculated threshold
export type Vault = CoreVault & {
  threshold?: number
}
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
  chains: Array<
    | 'evm'
    | 'utxo'
    | 'cosmos'
    | 'solana'
    | 'sui'
    | 'polkadot'
    | 'ton'
    | 'ripple'
    | 'tron'
    | 'cardano'
  >
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
  decimals: number
  symbol: string
  chainId: string
  tokenId?: string
  value?: number // USD value
}

export type CachedBalance = {
  balance: Balance
  cachedAt: number // Unix timestamp when cached
  ttl: number // Time to live in milliseconds (5 minutes = 300000)
}

export type SigningMode = 'fast' | 'relay' | 'local'

export type SigningPayload = {
  transaction: any // Chain-specific transaction data
  chain: any
  derivePath?: string
  messageHashes?: string[] // Pre-computed message hashes for signing
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
  wasmConfig?: {
    autoInit?: boolean
    wasmPaths?: {
      walletCore?: string
      dkls?: string
      schnorr?: string
    }
  }
}

import type { Chain } from '@core/chain/Chain'

// Extended SDK config with storage and connection options
export type VultisigConfig = SDKConfig & {
  storage?: any // VaultStorage interface (avoiding circular dependency)
  autoInit?: boolean
  autoConnect?: boolean
  defaultChains?: Chain[]
  defaultCurrency?: string
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

export type VaultManagerConfig = {
  defaultChains: string[]
  defaultCurrency: string
}

export type VaultCreationStep = {
  step:
    | 'initializing'
    | 'keygen'
    | 'deriving_addresses'
    | 'fetching_balances'
    | 'applying_tokens'
    | 'complete'
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

export type VaultSigner = {
  id: string
  publicKey: string
  name?: string
}

export type Summary = {
  id: string
  name: string
  isEncrypted: boolean
  createdAt: number
  lastModified: number
  size: number
  type: VaultType
  currency: string
  chains: string[]
  tokens: Record<string, Token[]>
  threshold: number
  totalSigners: number
  vaultIndex: number
  signers: VaultSigner[]
  isBackedUp: () => boolean
  keys: {
    ecdsa: string
    eddsa: string
    hexChainCode: string
    hexEncryptionKey: string
  }
}

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

export type Value = {
  amount: string
  currency: string
  symbol: string
  rate: number
  lastUpdated: number
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
