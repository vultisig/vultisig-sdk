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
  dryRun?: boolean // Preview transaction without signing/broadcasting
  password?: string // Vault password for signing
  signal?: AbortSignal // Optional abort signal for cancellation
}

/**
 * Result of a send dry-run preview
 */
export type SendDryRunResult = {
  dryRun: true
  chain: string
  to: string
  amount: string
  symbol: string
  balance: string
  warning?: string
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
