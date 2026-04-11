import { Chain } from '@vultisig/core-chain/Chain'
import type { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import type { VultDiscountTier } from '@vultisig/core-chain/swap/affiliate'
import { findSwapQuote as coreFindSwapQuote } from '@vultisig/core-chain/swap/quote/findSwapQuote'
import type { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'

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
}

export type { SwapQuote }

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
export const findSwapQuote = async (params: FindSwapQuoteParams): Promise<SwapQuote> => {
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

  return coreFindSwapQuote({
    from,
    to,
    amount: params.amount,
    referral: params.referral,
    vultDiscountTier: params.vultDiscountTier,
  })
}
