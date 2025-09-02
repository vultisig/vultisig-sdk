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
export type { Vault, VaultKeyShares } from '@core/ui/vault/Vault'
export type { VaultFolder } from '@core/ui/vault/VaultFolder'
export type { VaultSecurityType } from '@core/ui/vault/VaultSecurityType'

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
  format: 'DKLS' | 'GG20'
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

export type SigningPayload = {
  transaction: any // Chain-specific transaction data
  chain: any
  derivePath?: string
}

export type Signature = {
  signature: string
  recovery?: number
  format: 'DER' | 'ECDSA' | 'EdDSA'
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
