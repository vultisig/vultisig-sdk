import { Chain } from '@vultisig/core-chain/Chain'
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT,
  generalSwapProviderRiskMetadata,
  isSameChainEvmErc20SellForQuotePolicy,
  resolveGeneralSwapQuotePolicy,
  SAME_CHAIN_EVM_ERC20_SELL_EXCLUDED_PROVIDERS,
} from './generalSwapQuotePolicy'

describe('general swap quote policy', () => {
  it('applies the SDK-owned default slippage tolerance', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Base,
      })
    ).toEqual({ slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT })
  })

  it('preserves explicit slippage tolerance', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Base,
        slippageTolerance: 2.5,
      })
    ).toEqual({ slippageTolerance: 2.5 })
  })

  it('excludes route-dependent spender providers for same-chain EVM ERC-20 sells', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Ethereum,
        fromTokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    ).toEqual({
      slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT,
      excludeProviders: [...SAME_CHAIN_EVM_ERC20_SELL_EXCLUDED_PROVIDERS],
    })
  })

  it('keeps SwapKit and LiFi eligible for cross-chain EVM swaps', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Base,
        fromTokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      })
    ).toEqual({ slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT })
  })

  it('keeps SwapKit and LiFi eligible for same-chain native EVM sells', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Ethereum,
      })
    ).toEqual({ slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT })
  })

  it('keeps SwapKit and LiFi eligible for non-EVM same-chain swaps', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Solana,
        toChain: Chain.Solana,
        fromTokenId: 'So11111111111111111111111111111111111111112',
      })
    ).toEqual({ slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT })
  })

  it('preserves caller exclusions and appends policy exclusions once', () => {
    expect(
      resolveGeneralSwapQuotePolicy({
        fromChain: Chain.Ethereum,
        toChain: Chain.Ethereum,
        fromTokenId: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        excludeProviders: ['CowSwap', 'LiFi'],
      })
    ).toEqual({
      slippageTolerance: DEFAULT_GENERAL_SWAP_QUOTE_SLIPPAGE_TOLERANCE_PERCENT,
      excludeProviders: ['CowSwap', 'LiFi', 'SwapKit'],
    })
  })

  it('exports the swap-shape predicate for callers that need branch-specific rendering', () => {
    expect(
      isSameChainEvmErc20SellForQuotePolicy({
        fromChain: Chain.Arbitrum,
        toChain: Chain.Arbitrum,
        fromTokenId: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      })
    ).toBe(true)
  })

  it('documents provider risk metadata for the policy-owned exclusions', () => {
    expect(generalSwapProviderRiskMetadata.SwapKit.sameChainEvmErc20Sell).toBe('excluded')
    expect(generalSwapProviderRiskMetadata.LiFi.sameChainEvmErc20Sell).toBe('excluded')
    expect(generalSwapProviderRiskMetadata.KyberSwap.sameChainEvmErc20Sell).toBe('eligible')
    expect(generalSwapProviderRiskMetadata['1inch'].sameChainEvmErc20Sell).toBe('eligible')
  })
})
