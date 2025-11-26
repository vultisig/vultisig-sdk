/**
 * SwapService - Handles swap quote fetching and transaction preparation
 *
 * This service wraps core swap functions and provides:
 * - Quote fetching from multiple providers (1inch, KyberSwap, LiFi, THORChain, MayaChain)
 * - ERC-20 allowance checking
 * - Swap transaction preparation with approval handling
 * - Chain support queries
 */

import { Chain } from '@core/chain/Chain'
import { isChainOfKind } from '@core/chain/ChainKind'
import { getErc20Allowance } from '@core/chain/chains/evm/erc20/getErc20Allowance'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { findSwapQuote, FindSwapQuoteInput } from '@core/chain/swap/quote/findSwapQuote'
import { SwapQuote } from '@core/chain/swap/quote/SwapQuote'
import { swapEnabledChains } from '@core/chain/swap/swapEnabledChains'
import { buildSwapKeysignPayload } from '@core/mpc/keysign/swap/build'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'

import { VaultEvents } from '../../events/types'
import { WasmManager } from '../../wasm'
import {
  CoinInput,
  isAccountCoin,
  SwapApprovalInfo,
  SwapFees,
  SwapPrepareResult,
  SwapQuoteParams,
  SwapQuoteResult,
  SwapTxParams,
} from '../swap-types'
import { VaultError, VaultErrorCode } from '../VaultError'

// Default quote expiry (60 seconds for general swaps)
const DEFAULT_QUOTE_EXPIRY_MS = 60_000

/**
 * SwapService handles all swap-related operations
 */
export class SwapService {
  constructor(
    private vaultData: CoreVault,
    private getAddress: (chain: Chain) => Promise<string>,
    private emitEvent: <K extends keyof VaultEvents>(event: K, data: VaultEvents[K]) => void
  ) {}

  /**
   * Get a swap quote from the best available provider
   */
  async getQuote(params: SwapQuoteParams): Promise<SwapQuoteResult> {
    try {
      // Resolve coin inputs to full AccountCoin
      const fromCoin = await this.resolveCoinInput(params.fromCoin)
      const toCoin = await this.resolveCoinInput(params.toCoin)

      // Call core's findSwapQuote
      const quoteInput: FindSwapQuoteInput = {
        from: fromCoin,
        to: toCoin,
        amount: params.amount,
        referral: params.referral,
        affiliateBps: params.affiliateBps,
      }

      const quote = await findSwapQuote(quoteInput)

      // Check if approval is required (for ERC-20 tokens)
      const approvalInfo = await this.checkApprovalRequired(fromCoin, params.amount, quote)

      // Format the result
      const result = this.formatQuoteResult(quote, fromCoin, toCoin, approvalInfo)

      // Emit event
      this.emitEvent('swapQuoteReceived', { quote: result })

      return result
    } catch (error) {
      const wrapped = this.wrapSwapError(error)
      this.emitEvent('error', wrapped)
      throw wrapped
    }
  }

  /**
   * Prepare a swap transaction for signing
   */
  async prepareSwapTx(params: SwapTxParams): Promise<SwapPrepareResult> {
    try {
      // Validate quote hasn't expired
      if (Date.now() > params.swapQuote.expiresAt) {
        throw new VaultError(VaultErrorCode.InvalidConfig, 'Swap quote has expired. Please refresh the quote.')
      }

      // Resolve coin inputs
      const fromCoin = await this.resolveCoinInput(params.fromCoin)
      const toCoin = await this.resolveCoinInput(params.toCoin)

      // Get wallet core
      const walletCore = await WasmManager.getWalletCore()

      // Get public keys for both chains
      const fromPublicKey = getPublicKey({
        chain: fromCoin.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      const toPublicKey = getPublicKey({
        chain: toCoin.chain,
        walletCore,
        publicKeys: this.vaultData.publicKeys,
        hexChainCode: this.vaultData.hexChainCode,
      })

      // Build keysign payload using core function
      const keysignPayload = await buildSwapKeysignPayload({
        fromCoin,
        toCoin,
        amount: params.amount,
        swapQuote: params.swapQuote.quote,
        vaultId: this.vaultData.publicKeys.ecdsa,
        localPartyId: this.vaultData.localPartyId,
        fromPublicKey,
        toPublicKey,
        libType: this.vaultData.libType,
        walletCore,
      })

      // Handle approval based on autoApprove setting
      let approvalPayload: KeysignPayload | undefined

      if (!params.autoApprove && keysignPayload.erc20ApprovePayload) {
        // Manual mode: emit approval required event
        this.emitEvent('swapApprovalRequired', {
          token: fromCoin.id ?? fromCoin.ticker,
          spender: keysignPayload.erc20ApprovePayload.spender,
          amount: keysignPayload.erc20ApprovePayload.amount,
          currentAllowance: params.swapQuote.approvalInfo?.currentAllowance.toString() ?? '0',
        })

        // The approval is included in the keysignPayload.erc20ApprovePayload
        // The signing flow will handle creating separate transactions
        // We just need to signal that approval is needed
        approvalPayload = undefined // Core handles this internally via erc20ApprovePayload
      }

      // Emit swap prepared event
      this.emitEvent('swapPrepared', {
        provider: params.swapQuote.provider,
        fromAmount: params.amount.toString(),
        toAmountExpected: params.swapQuote.estimatedOutput,
        requiresApproval: !!keysignPayload.erc20ApprovePayload,
      })

      return {
        keysignPayload,
        approvalPayload,
        quote: params.swapQuote,
      }
    } catch (error) {
      if (error instanceof VaultError) {
        throw error
      }
      const wrapped = this.wrapSwapError(error)
      this.emitEvent('error', wrapped)
      throw wrapped
    }
  }

  /**
   * Check if swap is supported between two chains
   */
  isSwapSupported(fromChain: Chain, toChain: Chain): boolean {
    const enabledChains = swapEnabledChains as readonly Chain[]
    return enabledChains.includes(fromChain) && enabledChains.includes(toChain)
  }

  /**
   * Get list of chains that support swapping
   */
  getSupportedChains(): readonly Chain[] {
    return swapEnabledChains as readonly Chain[]
  }

  /**
   * Get ERC-20 token allowance
   */
  async getAllowance(coin: AccountCoin, spender: string): Promise<bigint> {
    // Only ERC-20 tokens have allowance
    if (!coin.id || !isChainOfKind(coin.chain, 'evm')) {
      return BigInt(0)
    }

    try {
      return await getErc20Allowance({
        chain: coin.chain,
        id: coin.id,
        address: coin.address,
        spender,
      })
    } catch {
      return BigInt(0)
    }
  }

  // ===== Private Methods =====

  /**
   * Resolve CoinInput to full AccountCoin
   */
  private async resolveCoinInput(input: CoinInput): Promise<AccountCoin> {
    if (isAccountCoin(input)) {
      return input
    }

    // Simplified input - need to resolve address and token info
    const address = await this.getAddress(input.chain)

    // Get native token info from chainFeeCoin
    const nativeCoin = chainFeeCoin[input.chain]

    // If token is specified, it's the contract address
    // If not specified, use native token
    if (input.token) {
      return {
        chain: input.chain,
        address,
        id: input.token, // Token contract address
        ticker: input.token.substring(0, 6), // Placeholder ticker
        decimals: 18, // Default to 18 for ERC-20 tokens
      }
    }

    return {
      chain: input.chain,
      address,
      ticker: nativeCoin.ticker,
      decimals: nativeCoin.decimals,
    }
  }

  /**
   * Check if ERC-20 approval is required for the swap
   */
  private async checkApprovalRequired(
    fromCoin: AccountCoin,
    amount: number,
    quote: SwapQuote
  ): Promise<SwapApprovalInfo | undefined> {
    // Only ERC-20 tokens need approval
    if (!fromCoin.id || !isChainOfKind(fromCoin.chain, 'evm')) {
      return undefined
    }

    // Get spender address from quote
    const spender = this.getSpenderFromQuote(quote)
    if (!spender) {
      return undefined
    }

    // Check current allowance
    const currentAllowance = await this.getAllowance(fromCoin, spender)
    const requiredAmount = BigInt(Math.floor(amount * 10 ** fromCoin.decimals))

    if (currentAllowance < requiredAmount) {
      return {
        spender,
        currentAllowance,
        requiredAmount,
      }
    }

    return undefined
  }

  /**
   * Extract spender address from quote
   */
  private getSpenderFromQuote(quote: SwapQuote): string | undefined {
    if ('general' in quote && quote.general.tx) {
      if ('evm' in quote.general.tx) {
        return quote.general.tx.evm.to
      }
    }
    if ('native' in quote && quote.native.router) {
      return quote.native.router
    }
    return undefined
  }

  /**
   * Format quote into SwapQuoteResult
   */
  private formatQuoteResult(
    quote: SwapQuote,
    fromCoin: AccountCoin,
    toCoin: AccountCoin,
    approvalInfo?: SwapApprovalInfo
  ): SwapQuoteResult {
    const isNative = 'native' in quote

    // Calculate expiry
    const expiresIn = isNative ? quote.native.expiry * 1000 - Date.now() : DEFAULT_QUOTE_EXPIRY_MS
    const expiresAt = Date.now() + Math.min(expiresIn, DEFAULT_QUOTE_EXPIRY_MS)

    // Extract estimated output
    const estimatedOutput = isNative
      ? this.formatAmount(quote.native.expected_amount_out, toCoin.decimals)
      : this.formatAmount(quote.general.dstAmount, toCoin.decimals)

    // Extract provider name
    const provider = isNative ? quote.native.swapChain.toLowerCase() : quote.general.provider

    // Extract fees
    const fees = this.extractFees(quote)

    // Extract warnings
    const warnings: string[] = []
    if (isNative && quote.native.warning) {
      warnings.push(quote.native.warning)
    }

    return {
      quote,
      estimatedOutput,
      provider,
      expiresAt,
      requiresApproval: !!approvalInfo,
      approvalInfo,
      fees,
      warnings,
    }
  }

  /**
   * Format raw amount to human-readable string
   */
  private formatAmount(rawAmount: string, decimals: number): string {
    const value = BigInt(rawAmount)
    const divisor = BigInt(10 ** decimals)
    const whole = value / divisor
    const fraction = value % divisor

    if (fraction === BigInt(0)) {
      return whole.toString()
    }

    const fractionStr = fraction.toString().padStart(decimals, '0')
    // Trim trailing zeros
    const trimmed = fractionStr.replace(/0+$/, '')
    return `${whole}.${trimmed}`
  }

  /**
   * Extract fees from quote
   */
  private extractFees(quote: SwapQuote): SwapFees {
    if ('native' in quote) {
      return {
        network: quote.native.fees.outbound,
        affiliate: quote.native.fees.affiliate,
        total: quote.native.fees.total,
      }
    }

    // General swaps - fees are embedded in the output amount
    return {
      network: '0',
      total: '0',
    }
  }

  /**
   * Wrap errors in VaultError with appropriate messages
   */
  private wrapSwapError(error: unknown): VaultError {
    if (error instanceof VaultError) {
      return error
    }

    const message = error instanceof Error ? error.message : String(error)

    // Check for known error patterns
    if (message.includes('No swap routes') || message.includes('NoSwapRoutesError')) {
      return new VaultError(
        VaultErrorCode.InvalidConfig,
        'No swap route found between these tokens. Try a different pair or provider.',
        error instanceof Error ? error : undefined
      )
    }

    if (message.includes('amount too small') || message.includes('not enough asset')) {
      return new VaultError(
        VaultErrorCode.InvalidConfig,
        `Swap amount too small: ${message}`,
        error instanceof Error ? error : undefined
      )
    }

    if (message.includes('insufficient')) {
      return new VaultError(
        VaultErrorCode.InvalidConfig,
        `Insufficient funds: ${message}`,
        error instanceof Error ? error : undefined
      )
    }

    return new VaultError(
      VaultErrorCode.InvalidConfig,
      `Swap failed: ${message}`,
      error instanceof Error ? error : undefined
    )
  }
}
