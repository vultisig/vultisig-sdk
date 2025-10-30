import { AddressService } from './services/AddressService'
import { BalanceService } from './services/BalanceService'
import { SigningService } from './services/SigningService'
import { FastSigningService } from './services/FastSigningService'

/**
 * Services required by Vault for operations
 * These are injected to avoid circular dependencies with VultisigSDK
 */
export interface VaultServices {
  addressService: AddressService
  balanceService: BalanceService
  signingService: SigningService
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
