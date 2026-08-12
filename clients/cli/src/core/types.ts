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
  destinationTag?: number
  yes?: boolean // Skip confirmation prompt
  dryRun?: boolean // Preview transaction without signing/broadcasting
  force?: boolean // Bypass the broadcast-journal duplicate guard
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
  /** Resolved token contract address / chain-specific asset id. Omitted for native sends. */
  contractAddress?: string
  /** Network fee the build estimated for this transaction, in `feeSymbol`. */
  fee: string
  /** Asset the fee is paid in — the chain's native asset, which is not `symbol` for a token send. */
  feeSymbol: string
  /**
   * What the send costs in `symbol`, and what `balance` is checked against:
   * amount + fee for a native send, amount alone for a token send (whose fee is
   * paid in `feeSymbol`, out of a different balance).
   */
  total: string
  balance: string
  destinationTag?: number
  /** User-visible memo the signer will include, excluding XRP's legacy destination-tag carrier. */
  memo?: string
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
  /** Sum of every row in `chainBalances`, native and token alike. */
  totalValue: Value
  chainBalances: Array<{
    chain: Chain
    /** Native balance for the chain. */
    balance: Balance
    /** Fiat value of the native balance. Absent when the price lookup failed. */
    value?: Value
    /**
     * Tracked tokens on this chain that carry a fiat value. Itemized so the
     * breakdown accounts for the whole total instead of leaving token value as
     * an unexplained gap between the total and the sum of the native rows.
     */
    tokens?: Array<{ tokenId: string; balance?: Balance; value: Value }>
  }>
}

/**
 * A per-chain failure encountered while building a portfolio.
 * `stage` marks whether the balance fetch or the fiat-value lookup failed.
 * `error` is a concise, single-line message (no stack traces or filesystem paths).
 */
export type ChainFailure = {
  chain: Chain
  stage: 'balance' | 'value'
  error: string
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
