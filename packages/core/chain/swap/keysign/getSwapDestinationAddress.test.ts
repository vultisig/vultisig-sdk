import { Chain } from '@vultisig/core-chain/Chain'
import { SwapQuote } from '@vultisig/core-chain/swap/quote/SwapQuote'
import { describe, expect, it } from 'vitest'

import { getSwapDestinationAddress } from './getSwapDestinationAddress'

const fromCoin = {
  chain: Chain.Bitcoin,
  address: 'bc1qsource',
  ticker: 'BTC',
  decimals: 8,
}

describe('getSwapDestinationAddress', () => {
  it('returns the transfer target for SwapKit source-chain transfer routes', () => {
    const quote: SwapQuote = {
      discounts: [],
      quote: {
        general: {
          dstAmount: '1000000000',
          provider: 'swapkit',
          tx: {
            transfer: {
              to: 'bc1qdeposit',
              amount: 100_000n,
              memo: 'route-memo',
            },
          },
        },
      },
    }

    expect(getSwapDestinationAddress({ quote, fromCoin })).toBe('bc1qdeposit')
  })
})
