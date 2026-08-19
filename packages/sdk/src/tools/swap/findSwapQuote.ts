import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import type { VultDiscountTier } from '@vultisig/core-chain/swap/affiliate'
import {
  findSwapQuote as coreFindSwapQuote,
  FindSwapQuoteInput,
  findSwapQuotes as coreFindSwapQuotes,
  FindSwapQuotesResult,
  SwapAffiliateConfig,
  SwapQuoteCandidate,
  SwapQuoteProviderExcludeName,
} from '@vultisig/core-chain/swap/quote/findSwapQuote'
import type { BoundSwapQuote, SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'

export type { FindSwapQuotesResult, SwapAffiliateConfig, SwapQuoteCandidate, SwapQuoteProviderExcludeName }
export type {
  GeneralSwapProviderRiskMetadata,
  GeneralSwapQuotePolicy,
  ResolveGeneralSwapQuotePolicyInput,
} from '@vultisig/core-chain/swap/quote/generalSwapQuotePolicy'
export {
  DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT,
  generalSwapProviderRiskMetadata,
  isSameChainEvmErc20SellForQuotePolicy,
  resolveGeneralSwapQuotePolicy,
  SAME_CHAIN_EVM_ERC20_SELL_EXCLUDED_PROVIDERS,
} from '@vultisig/core-chain/swap/quote/generalSwapQuotePolicy'

export type FindSwapQuoteParams = {
  fromChain: Chain
  fromAddress: string
  fromSymbol: string
  fromDecimals: number
  fromTokenId?: string

  toChain: Chain
  toAddress: string
  toSymbol: string
  toDecimals: number
  toTokenId?: string

  amount: bigint
  referral?: string
  vultDiscountTier?: VultDiscountTier | null
  affiliateConfig?: SwapAffiliateConfig

  /**
   * Optional external recipient for the swapped output. When omitted the swap
   * output goes to the initiator (`fromAddress` / vault-derived receiver).
   * Forwarded to the core resolver, which validates it and skips any provider
   * that would silently pay the wrong address.
   */
  recipient?: string

  /**
   * Optional max slippage tolerance in PERCENT (e.g. `0.5` = 0.5%, `3` = 3%).
   * When omitted each provider keeps its own default. Applied to the general
   * aggregators that accept an override (1inch, KyberSwap, LiFi) and to
   * THORChain/MayaChain native quotes (nativeBps); other native protocols use
   * their own protection and ignore it. The core resolver rejects out-of-range
   * values. Previously the public wrapper dropped this field entirely, so
   * `execute_swap.slippage_tolerance_percent` was silently ignored on every
   * THORChain/Maya + EVM-aggregator swap.
   */
  slippageTolerance?: number

  /**
   * Optional additive, opt-in list of swap providers to exclude from best-quote
   * selection. Accepts both display names (`CowSwap`, `KyberSwap`, `LiFi`) and
   * the raw returned-quote provider ids (`cowswap`, `kyber`, `li.fi`); unknown
   * tokens fail closed (throw) rather than silently leaving a provider eligible.
   * Use when the consumer can't build/sign a given provider's tx shape (e.g.
   * agent-backend-ts doesn't wire CowSwap's `cowswap_order` EIP-712 flow), so a
   * provider it can't route must not win the quote. Previously the public
   * wrapper dropped this field entirely, so `excludeProviders` was silently
   * ignored and the excluded provider could still win — the same silent-drop
   * class as `slippageTolerance` above.
   */
  excludeProviders?: SwapQuoteProviderExcludeName[]
}

export type { BoundSwapQuote, SwapQuote }

/**
 * Find the best swap quote across all providers (THORChain, MayaChain, 1inch, LiFi, KyberSwap).
 * Vault-free - only requires chain, address, and token information.
 *
 * @example
 * ```ts
 * const quote = await findSwapQuote({
 *   fromChain: 'Ethereum',
 *   fromAddress: '0xabc...',
 *   fromSymbol: 'ETH',
 *   fromDecimals: 18,
 *   toChain: 'Bitcoin',
 *   toAddress: 'bc1q...',
 *   toSymbol: 'BTC',
 *   toDecimals: 8,
 *   amount: 1000000000000000000n, // 1 ETH in wei
 * })
 * ```
 */
export const findSwapQuote = async (params: FindSwapQuoteParams): Promise<BoundSwapQuote> =>
  coreFindSwapQuote(toCoreFindSwapQuoteInput(params))

/**
 * Find the best swap quote plus the full ranked candidate set, so callers can
 * offer route selection instead of only the auto-selected winner. Same inputs
 * and error behavior as `findSwapQuote`; the winner equals what `findSwapQuote`
 * returns.
 */
export const findSwapQuotes = async (params: FindSwapQuoteParams): Promise<FindSwapQuotesResult> =>
  coreFindSwapQuotes(toCoreFindSwapQuoteInput(params))

const toCoreFindSwapQuoteInput = (params: FindSwapQuoteParams): FindSwapQuoteInput => {
  const from: AccountCoin = {
    chain: params.fromChain,
    address: params.fromAddress,
    ticker: params.fromSymbol,
    decimals: params.fromDecimals,
    id: params.fromTokenId,
  }

  const to: AccountCoin = {
    chain: params.toChain,
    address: params.toAddress,
    ticker: params.toSymbol,
    decimals: params.toDecimals,
    id: params.toTokenId,
  }

  return {
    from,
    to,
    amount: params.amount,
    referral: params.referral,
    vultDiscountTier: params.vultDiscountTier,
    affiliateConfig: params.affiliateConfig,
    recipient: params.recipient,
    slippageTolerance: params.slippageTolerance,
    excludeProviders: params.excludeProviders,
  }
}
