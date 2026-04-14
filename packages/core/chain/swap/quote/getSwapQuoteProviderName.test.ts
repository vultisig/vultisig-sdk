import { describe, expect, it } from 'vitest'

import { Chain } from '../../Chain'
import { getSwapQuoteProviderName } from './getSwapQuoteProviderName'
import type { SwapQuote } from './SwapQuote'

describe('getSwapQuoteProviderName', () => {
  it('returns the native swap chain label for native quotes', () => {
    const quote = {
      quote: { native: { swapChain: Chain.THORChain } },
      discounts: [],
    } as unknown as SwapQuote

    expect(getSwapQuoteProviderName(quote)).toBe(Chain.THORChain)
  })

  it('maps each general swap provider to its display name', () => {
    const cases: Array<{ provider: '1inch' | 'li.fi' | 'kyber'; label: string }> = [
      { provider: '1inch', label: '1Inch' },
      { provider: 'li.fi', label: 'LI.FI' },
      { provider: 'kyber', label: 'KyberSwap' },
    ]

    for (const { provider, label } of cases) {
      const quote = {
        quote: {
          general: {
            provider,
            dstAmount: '0',
            tx: {
              evm: {
                from: '0x0000000000000000000000000000000000000001',
                to: '0x0000000000000000000000000000000000000002',
                data: '0x',
                value: '0',
              },
            },
          },
        },
        discounts: [],
      } as unknown as SwapQuote

      expect(getSwapQuoteProviderName(quote)).toBe(label)
    }
  })
})
