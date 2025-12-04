/**
 * SwapService - Handles swap quote fetching and transaction preparation
 *
 * This service wraps core swap functions and provides:
 * - Quote fetching from multiple providers (1inch, KyberSwap, LiFi, THORChain, MayaChain)
 * - ERC-20 allowance checking
 * - Swap transaction preparation with approval handling
 * - Chain support queries
 */

import { toChainAmount } from '@core/chain/amount/toChainAmount'
import { Chain, EvmChain } from '@core/chain/Chain'
import { isChainOfKind } from '@core/chain/ChainKind'
import { getErc20Allowance } from '@core/chain/chains/evm/erc20/getErc20Allowance'
import { AccountCoin } from '@core/chain/coin/AccountCoin'
import { chainFeeCoin } from '@core/chain/coin/chainFeeCoin'
import { getTokenMetadata } from '@core/chain/coin/token/metadata'
import { chainsWithTokenMetadataDiscovery } from '@core/chain/coin/token/metadata/chains'
import { getCoinValue } from '@core/chain/coin/utils/getCoinValue'
import { getPublicKey } from '@core/chain/publicKey/getPublicKey'
import { findSwapQuote, FindSwapQuoteInput } from '@core/chain/swap/quote/findSwapQuote'
import { SwapQuote } from '@core/chain/swap/quote/SwapQuote'
import { swapEnabledChains } from '@core/chain/swap/swapEnabledChains'
import { getEvmBaseFee } from '@core/chain/tx/fee/evm/baseFee'
import { getEvmMaxPriorityFeePerGas } from '@core/chain/tx/fee/evm/maxPriorityFeePerGas'
import { FiatCurrency } from '@core/config/FiatCurrency'
import { buildSwapKeysignPayload } from '@core/mpc/keysign/swap/build'
import { KeysignPayload } from '@core/mpc/types/vultisig/keysign/v1/keysign_message_pb'
import { Vault as CoreVault } from '@core/mpc/vault/Vault'

import type { WasmProvider } from '../../context/SdkContext'
import { VaultEvents } from '../../events/types'
import type { FiatValueService } from '../../services/FiatValueService'
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
    private emitEvent: <K extends keyof VaultEvents>(event: K, data: VaultEvents[K]) => void,
    private wasmProvider: WasmProvider,
    private fiatValueService?: FiatValueService
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
        amount: toChainAmount(params.amount, fromCoin.decimals),
        referral: params.referral,
        affiliateBps: params.affiliateBps,
      }

      const quote = await findSwapQuote(quoteInput)

      // Check if approval is required (for ERC-20 tokens)
      const approvalInfo = await this.checkApprovalRequired(fromCoin, params.amount, quote)

      // Format the result (with optional fiat conversion)
      const result = await this.formatQuoteResult(quote, fromCoin, toCoin, approvalInfo, params.fiatCurrency)

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

      // Get wallet core via WasmProvider
      const walletCore = await this.wasmProvider.getWalletCore()

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
        toAmountExpected: params.swapQuote.estimatedOutput.toString(),
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
   * Check if swap is supported between two chains.
   * @param fromChain - Source chain
   * @param toChain - Destination chain
   * @returns true if swapping is supported between these chains
   */
  isSwapSupported(fromChain: Chain, toChain: Chain): boolean {
    const enabledChains = swapEnabledChains as readonly Chain[]
    return enabledChains.includes(fromChain) && enabledChains.includes(toChain)
  }

  /**
   * Get list of chains that support swapping.
   * @returns Array of chains that can be used for swaps
   */
  getSupportedChains(): readonly Chain[] {
    return swapEnabledChains as readonly Chain[]
  }

  /**
   * Get ERC-20 token allowance for a spender.
   * @param coin - The token to check allowance for
   * @param spender - The spender address (usually DEX router)
   * @returns Current allowance amount (0 for non-ERC20 tokens)
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

    // If token is specified, fetch real metadata from chain
    if (input.token) {
      // Check if chain supports token metadata discovery
      const supportsMetadata = (chainsWithTokenMetadataDiscovery as readonly Chain[]).includes(input.chain)

      if (supportsMetadata) {
        try {
          const metadata = await getTokenMetadata({
            chain: input.chain as any,
            id: input.token,
          })

          return {
            chain: input.chain,
            address,
            id: input.token,
            ticker: metadata.ticker,
            decimals: metadata.decimals,
          }
        } catch (error) {
          throw new VaultError(
            VaultErrorCode.UnsupportedToken,
            `Failed to fetch metadata for token ${input.token} on ${input.chain}: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      }

      // Fallback for chains without metadata discovery (shouldn't happen for swap-enabled chains)
      throw new VaultError(
        VaultErrorCode.UnsupportedToken,
        `Token metadata discovery not supported for chain ${input.chain}`
      )
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
  private async formatQuoteResult(
    quote: SwapQuote,
    fromCoin: AccountCoin,
    toCoin: AccountCoin,
    approvalInfo?: SwapApprovalInfo,
    fiatCurrency?: FiatCurrency
  ): Promise<SwapQuoteResult> {
    const isNative = 'native' in quote

    // Calculate expiry
    const expiresIn = isNative ? quote.native.expiry * 1000 - Date.now() : DEFAULT_QUOTE_EXPIRY_MS
    const expiresAt = Date.now() + Math.min(expiresIn, DEFAULT_QUOTE_EXPIRY_MS)

    // Extract estimated output as bigint
    const estimatedOutput = isNative ? BigInt(quote.native.expected_amount_out) : BigInt(quote.general.dstAmount)

    // Extract provider name
    const provider = isNative ? quote.native.swapChain.toLowerCase() : quote.general.provider

    // Extract fees
    const fees = await this.extractFees(quote, fromCoin.chain)

    // Extract warnings
    const warnings: string[] = []
    if (isNative && quote.native.warning) {
      warnings.push(quote.native.warning)
    }

    // Build base result
    const result: SwapQuoteResult = {
      quote,
      estimatedOutput,
      provider,
      expiresAt,
      requiresApproval: !!approvalInfo,
      approvalInfo,
      fees,
      warnings,
      fromCoin: {
        chain: fromCoin.chain,
        ticker: fromCoin.ticker,
        decimals: fromCoin.decimals,
        tokenId: fromCoin.id,
      },
      toCoin: {
        chain: toCoin.chain,
        ticker: toCoin.ticker,
        decimals: toCoin.decimals,
        tokenId: toCoin.id,
      },
    }

    // Calculate fiat values if fiatValueService is available and fiatCurrency requested
    if (fiatCurrency && this.fiatValueService) {
      try {
        // Get price for fee token (native token of from chain)
        const feeTokenDecimals = chainFeeCoin[fromCoin.chain].decimals
        const feePrice = await this.fiatValueService.getPrice(fromCoin.chain, undefined, fiatCurrency)

        result.feesFiat = {
          network: getCoinValue({ amount: fees.network, decimals: feeTokenDecimals, price: feePrice }),
          affiliate: fees.affiliate
            ? getCoinValue({ amount: fees.affiliate, decimals: feeTokenDecimals, price: feePrice })
            : undefined,
          total: getCoinValue({ amount: fees.total, decimals: feeTokenDecimals, price: feePrice }),
          currency: fiatCurrency,
        }

        // Get price for output token
        const toPrice = await this.fiatValueService.getPrice(toCoin.chain, toCoin.id, fiatCurrency)
        result.estimatedOutputFiat = getCoinValue({
          amount: estimatedOutput,
          decimals: toCoin.decimals,
          price: toPrice,
        })
      } catch {
        // Silently skip fiat calculation if price fetch fails
      }
    }

    return result
  }

  /**
   * Extract fees from quote
   */
  private async extractFees(quote: SwapQuote, fromChain: Chain): Promise<SwapFees> {
    if ('native' in quote) {
      return {
        network: BigInt(quote.native.fees.outbound),
        affiliate: quote.native.fees.affiliate ? BigInt(quote.native.fees.affiliate) : undefined,
        total: BigInt(quote.native.fees.total),
      }
    }

    // General swaps
    const { tx } = quote.general

    // Solana has explicit fees in the quote
    if ('solana' in tx) {
      const networkFee = tx.solana.networkFee
      const swapFee = tx.solana.swapFee.amount
      return {
        network: networkFee,
        total: networkFee + swapFee,
      }
    }

    // EVM - estimate from gasLimit × gas price
    if ('evm' in tx && tx.evm.gasLimit) {
      try {
        const evmChain = fromChain as EvmChain
        const baseFee = await getEvmBaseFee(evmChain)
        const priorityFee = await getEvmMaxPriorityFeePerGas(evmChain)
        const networkFee = tx.evm.gasLimit * (baseFee + priorityFee)
        return {
          network: networkFee,
          total: networkFee,
        }
      } catch {
        // Fall through to default if gas price fetch fails
      }
    }

    // Fallback for unknown swap types
    return {
      network: 0n,
      total: 0n,
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
