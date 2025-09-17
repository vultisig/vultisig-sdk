/**
 * Core types for VultisigSDK
 * Re-exports and extends types from core packages
 */

// Re-export core types from their actual locations
export type { ChainKind } from '../core/chain/ChainKind'
export type { AccountCoin } from '../core/chain/coin/AccountCoin'
export type { Coin } from '../core/chain/coin/Coin'
export type { PublicKeys } from '../core/chain/publicKey/PublicKeys'
export type { MpcServerType } from '../core/mpc/MpcServerType'
import type { Vault as CoreVault } from '../core/ui/vault/Vault'
export type { VaultKeyShares } from '../core/ui/vault/Vault'

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
  value?: number // USD value
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
  format: 'DER' | 'ECDSA' | 'EdDSA'
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
  chain: string
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

export type GasInfo = {
  chainId: string
  gasPrice: string
  gasPriceGwei?: string
  priorityFee?: string
  maxFeePerGas?: string
  lastUpdated: number
}

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
