import { Chain } from '@vultisig/core-chain/Chain'
import { isChainOfKind } from '@vultisig/core-chain/ChainKind'

import type { SwapQuoteProviderExcludeName, SwapQuoteProviderName } from './findSwapQuote'

export const DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT = 1

export const SAME_CHAIN_EVM_ERC20_SELL_EXCLUDED_PROVIDERS = ['SwapKit', 'LiFi'] as const

export type GeneralSwapProviderRiskMetadata = {
  approvalSpender: 'router' | 'provider-reported' | 'route-dependent'
  sameChainEvmErc20Sell: 'eligible' | 'excluded'
  reason: string
}

export const generalSwapProviderRiskMetadata = {
  '1inch': {
    approvalSpender: 'router',
    sameChainEvmErc20Sell: 'eligible',
    reason: 'Same-chain EVM ERC-20 routes use a stable router spender.',
  },
  KyberSwap: {
    approvalSpender: 'router',
    sameChainEvmErc20Sell: 'eligible',
    reason: 'Same-chain EVM ERC-20 routes use a stable router spender.',
  },
  LiFi: {
    approvalSpender: 'provider-reported',
    sameChainEvmErc20Sell: 'excluded',
    reason: 'Same-chain EVM ERC-20 routes can require a route-dependent spender outside the router fast path.',
  },
  SwapKit: {
    approvalSpender: 'route-dependent',
    sameChainEvmErc20Sell: 'excluded',
    reason: 'Same-chain EVM ERC-20 routes can bury the effective spender inside provider calldata.',
  },
} as const satisfies Partial<Record<SwapQuoteProviderName, GeneralSwapProviderRiskMetadata>>

export type ResolveGeneralSwapQuotePolicyInput = {
  fromChain: Chain
  toChain: Chain
  /**
   * Source token contract/id. Undefined/null/empty means the source is the
   * chain fee coin, which does not need an ERC-20 approval spender.
   */
  fromTokenId?: string | null
  /**
   * Optional caller-supplied tolerance in percent. When omitted, chat/backend
   * consumers use the SDK-owned default instead of each provider's unrelated
   * fallback.
   */
  slippageTolerance?: number
  /**
   * Existing caller exclusions are preserved and the policy exclusions are
   * appended when the swap shape requires them.
   */
  excludeProviders?: readonly SwapQuoteProviderExcludeName[]
}

export type GeneralSwapQuotePolicy = {
  slippageTolerance: number
  excludeProviders?: SwapQuoteProviderExcludeName[]
}

const hasSourceTokenId = (fromTokenId: string | null | undefined): boolean =>
  typeof fromTokenId === 'string' && fromTokenId.trim().length > 0

export const isSameChainEvmErc20SellForQuotePolicy = ({
  fromChain,
  toChain,
  fromTokenId,
}: Pick<ResolveGeneralSwapQuotePolicyInput, 'fromChain' | 'toChain' | 'fromTokenId'>): boolean =>
  fromChain === toChain && isChainOfKind(fromChain, 'evm') && hasSourceTokenId(fromTokenId)

const appendUniqueExclusions = (
  base: readonly SwapQuoteProviderExcludeName[] | undefined,
  additions: readonly SwapQuoteProviderExcludeName[]
): SwapQuoteProviderExcludeName[] => {
  const result = [...(base ?? [])]
  for (const provider of additions) {
    if (!result.includes(provider)) {
      result.push(provider)
    }
  }
  return result
}

export const resolveGeneralSwapQuotePolicy = (input: ResolveGeneralSwapQuotePolicyInput): GeneralSwapQuotePolicy => {
  const excludeProviders = isSameChainEvmErc20SellForQuotePolicy(input)
    ? appendUniqueExclusions(input.excludeProviders, SAME_CHAIN_EVM_ERC20_SELL_EXCLUDED_PROVIDERS)
    : [...(input.excludeProviders ?? [])]

  return {
    slippageTolerance: input.slippageTolerance ?? DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT,
    ...(excludeProviders.length > 0 ? { excludeProviders } : {}),
  }
}
