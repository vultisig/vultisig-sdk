/**
 * Chain operations module
 * Handles multi-chain blockchain interactions
 */

// ChainManager removed - was orphaned code not used by Vault
// AddressDeriver removed - chain operations now use core functions directly
// ChainConfig removed - replaced by internal chain utils (not exported)

// Chain strategies removed - using core functions directly instead

// Re-export specific chain types that are available
export type { Chain } from '@core/chain/Chain'
export type { ChainKind } from '@core/chain/ChainKind'

// Stub types for compilation - actual types come from core workspace
export type ChainEntity = any
export type AccountCoin = any
export type Coin = any