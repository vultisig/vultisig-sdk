/**
 * Swap Types for VultisigSDK
 *
 * These types define the swap functionality exposed through VaultBase.
 */

import type { Chain } from '@core/chain/Chain'
import type { AccountCoin } from '@core/chain/coin/AccountCoin'
import type { SwapQuote } from '@core/chain/swap/quote/SwapQuote'
import type { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'

// Re-export core swap types for SDK consumers
export type { GeneralSwapProvider } from '@core/chain/swap/general/GeneralSwapProvider'
export type { GeneralSwapQuote } from '@core/chain/swap/general/GeneralSwapQuote'
export type { NativeSwapQuote } from '@core/chain/swap/native/NativeSwapQuote'
export type { SwapQuote } from '@core/chain/swap/quote/SwapQuote'

/**
 * Simplified coin input format
 * Alternative to full AccountCoin for easier usage
 */
export type SimpleCoinInput = {
  /** Chain for the coin */
  chain: Chain
  /** Token contract address or symbol (omit for native token) */
  token?: string
}

/**
 * Union type supporting both full AccountCoin and simplified input
 */
export type CoinInput = AccountCoin | SimpleCoinInput

/**
 * Parameters for getting a swap quote
 */
export type SwapQuoteParams = {
  /** Source coin to swap from */
  fromCoin: CoinInput
  /** Destination coin to swap to */
  toCoin: CoinInput
  /** Amount to swap in human-readable format (e.g., 1.5 for 1.5 ETH) */
  amount: number
  /** Optional referral address for affiliate fees */
  referral?: string
  /** Affiliate fee in basis points (e.g., 50 = 0.5%) */
  affiliateBps?: number
}

/**
 * Approval information for ERC-20 token swaps
 */
export type SwapApprovalInfo = {
  /** Contract address of the spender (DEX router) */
  spender: string
  /** Current allowance amount */
  currentAllowance: bigint
  /** Required allowance amount for this swap */
  requiredAmount: bigint
}

/**
 * Fee breakdown for a swap
 */
export type SwapFees = {
  /** Network/gas fees */
  network: string
  /** Affiliate fees (if applicable) */
  affiliate?: string
  /** Total fees */
  total: string
}

/**
 * Result from getSwapQuote()
 */
export type SwapQuoteResult = {
  /** Raw quote from core (for use with prepareSwapTx) */
  quote: SwapQuote
  /** Expected output amount (human-readable) */
  estimatedOutput: string
  /** Provider used for the swap (e.g., '1inch', 'thorchain', 'kyber', 'li.fi') */
  provider: string
  /** Quote expiry timestamp (milliseconds) */
  expiresAt: number
  /** Whether ERC-20 approval is required before swap */
  requiresApproval: boolean
  /** Approval details (when requiresApproval is true) */
  approvalInfo?: SwapApprovalInfo
  /** Fee breakdown */
  fees: SwapFees
  /** Warnings from the quote provider */
  warnings: string[]
}

/**
 * Parameters for preparing a swap transaction
 */
export type SwapTxParams = {
  /** Source coin to swap from */
  fromCoin: CoinInput
  /** Destination coin to swap to */
  toCoin: CoinInput
  /** Amount to swap in human-readable format */
  amount: number
  /** Quote obtained from getSwapQuote() */
  swapQuote: SwapQuoteResult
  /**
   * Whether to handle approval automatically
   * - false (default): Returns separate approvalPayload if needed
   * - true: Core handles approval internally (may require 2 signatures)
   */
  autoApprove?: boolean
}

/**
 * Result from prepareSwapTx()
 */
export type SwapPrepareResult = {
  /** Main swap transaction payload */
  keysignPayload: KeysignPayload
  /**
   * Separate approval payload (when autoApprove=false and approval needed)
   * Must be signed and broadcast before the swap transaction
   */
  approvalPayload?: KeysignPayload
  /** The quote used for this transaction */
  quote: SwapQuoteResult
}

/**
 * Type guard to check if input is a full AccountCoin
 */
export function isAccountCoin(input: CoinInput): input is AccountCoin {
  return (
    'address' in input &&
    'decimals' in input &&
    typeof (input as AccountCoin).address === 'string' &&
    typeof (input as AccountCoin).decimals === 'number'
  )
}

/**
 * Type guard to check if input is a SimpleCoinInput
 */
export function isSimpleCoinInput(input: CoinInput): input is SimpleCoinInput {
  return !isAccountCoin(input)
}
