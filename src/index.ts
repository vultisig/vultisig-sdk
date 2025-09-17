/**
 * VultisigSDK - TypeScript SDK for secure multi-party computation and blockchain operations
 * 
 * This SDK provides a clean interface to Vultisig's core functionality:
 * - Multi-device vault creation and management
 * - Secure transaction signing via MPC
 * - Multi-chain blockchain support
 * - Server-assisted operations (Fast Vault)
 * - Cross-device message relay
 */

// Core SDK class
export { Vultisig } from './VultisigSDK'
export { Vultisig as VultisigSDK } from './VultisigSDK'

// Vault management
export * from './vault'

// MPC operations
export * from './mpc'

// Chain operations
export * from './chains'

// Server communication
export * from './server'

// Cryptographic utilities
export * from './crypto'

// Types and interfaces
export * from './types'

// WASM utilities
export * from './wasm'

// Re-export core types that are part of the public API
export type { 
  Vault,
  VaultKeyShares,
  VaultFolder,
  VaultSecurityType,
  ChainKind,
  PublicKeys,
  MpcServerType,
  AccountCoin,
  Coin
} from './types'