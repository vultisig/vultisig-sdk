/**
 * Chain operations module
 * Handles multi-chain blockchain interactions
 */

export { ChainManager } from './ChainManager'
export { AddressDeriver } from './AddressDeriver'

// Chain strategies
export { EvmStrategy } from './evm/EvmStrategy'
export { SolanaStrategy } from './solana/SolanaStrategy'
export { UtxoStrategy } from './utxo/UtxoStrategy'
export { ChainStrategyFactory, createDefaultStrategyFactory } from './strategies/ChainStrategyFactory'

// Re-export specific chain types that are available
export type { Chain } from '@core/chain/Chain'
export type { ChainKind } from '@core/chain/ChainKind'

// Stub types for compilation - actual types come from core workspace
export type ChainEntity = any
export type AccountCoin = any
export type Coin = any