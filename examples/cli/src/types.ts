import type { Balance, Chain, FiatCurrency, Value } from '@vultisig/sdk'

/**
 * Keysign payload type (internal SDK type)
 */
export type KeysignPayload = any

/**
 * Parameters for sending a transaction
 */
export type SendParams = {
  chain: Chain
  to: string
  amount: string // Human-readable amount (e.g., "1.5")
  tokenId?: string
  memo?: string
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
  storagePath?: string
  defaultCurrency?: FiatCurrency
}
