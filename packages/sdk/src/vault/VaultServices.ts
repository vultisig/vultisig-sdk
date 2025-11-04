import { FastSigningService } from './services/FastSigningService'
import { WASMManager } from '../wasm/WASMManager'

/**
 * Services required by Vault for operations
 * Simplified - only essential services needed
 * Vault calls core functions directly - no service layers
 */
export interface VaultServices {
  wasmManager: WASMManager
  fastSigningService?: FastSigningService
}

/**
 * Configuration for Vault initialization
 * Contains user-level preferences, not static chain data
 */
export interface VaultConfig {
  /** Default chains for new vaults (from SDK config) */
  defaultChains?: string[]
  /** Default currency for balance display (from SDK config) */
  defaultCurrency?: string
}
