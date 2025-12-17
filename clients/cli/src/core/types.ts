/**
 * Shared type definitions for CLI and Interactive Shell
 */
import type { Balance, Chain, FiatCurrency, Value } from '@vultisig/sdk'

/**
 * Parameters for sending a transaction
 */
export type SendParams = {
  chain: Chain
  to: string
  amount: string // Human-readable amount (e.g., "1.5")
  tokenId?: string
  memo?: string
  yes?: boolean // Skip confirmation prompt
  password?: string // Vault password for signing
}

/**
 * Result of a broadcasted transaction
 */
export type TransactionResult = {
  txHash: string
  chain: Chain
  explorerUrl: string
}

/**
 * Portfolio summary with breakdown by chain
 */
export type PortfolioSummary = {
  totalValue: Value
  chainBalances: Array<{
    chain: Chain
    balance: Balance
    value?: Value
  }>
}

/**
 * Configuration options for the wallet
 */
export type WalletConfig = {
  serverUrl?: string
  relayUrl?: string
  defaultCurrency?: FiatCurrency
}

/**
 * Vault status information for display
 */
export type VaultStatus = {
  name: string
  id: string
  type: string
  isUnlocked: boolean
  timeRemaining?: number
  timeRemainingFormatted?: string
  createdAt: number
  lastModified: number
  threshold: number
  totalSigners: number
  libType: string
  isEncrypted: boolean
  isBackedUp: boolean
  chains: number
  currency: FiatCurrency
  availableSigningModes: string[]
}
