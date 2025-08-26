/**
 * Core types for VultisigSDK
 * Re-exports and extends types from core packages
 */

// Re-export core types from their actual locations
export type { 
  Vault,
  VaultKeyShares
} from '@core/ui/vault/Vault'

export type {
  VaultFolder
} from '@core/ui/vault/VaultFolder'

export type {
  VaultSecurityType
} from '@core/ui/vault/VaultSecurityType'

export type {
  ChainKind
} from '@core/chain/ChainKind'

export type {
  PublicKeys
} from '@core/chain/publicKey/PublicKeys'

export type {
  MpcServerType
} from '@core/mpc/MpcServerType'

export type {
  AccountCoin
} from '@core/chain/coin/AccountCoin'

export type {
  Coin
} from '@core/chain/coin/Coin'

// SDK-specific types
export interface VaultOptions {
  name: string
  threshold: number
  participants: string[]
  email?: string
  password?: string
  serverAssisted?: boolean
}

export interface VaultBackup {
  data: ArrayBuffer | string
  format: 'DKLS' | 'GG20'
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

export interface VaultValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface ExportOptions {
  password?: string
  format?: 'dat' | 'vult'
  includeMetadata?: boolean
}

export interface Balance {
  amount: string
  decimals: number
  symbol: string
  value?: number // USD value
}

export interface SigningPayload {
  transaction: any // Chain-specific transaction data
  chain: any
  derivePath?: string
}

export interface Signature {
  signature: string
  recovery?: number
  format: 'DER' | 'ECDSA' | 'EdDSA'
}

export interface ReshareOptions {
  newThreshold: number
  newParticipants: string[]
  removeParticipants?: string[]
}

export interface ServerStatus {
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

export interface SDKConfig {
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