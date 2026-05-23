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
  it('returns the to address for evm routes', () => {
    const quote: SwapQuote = {
      discounts: [],
      quote: {
        general: {
          dstAmount: '1000000000000000000',
          provider: 'swapkit',
          tx: {
            evm: {
              from: '0xsource',
              to: '0xrouter',
              data: '0x',
              value: '0',
            },
          },
        },
      },
    }

    expect(getSwapDestinationAddress({ quote, fromCoin })).toBe('0xrouter')
  })

  it('returns empty string for solana routes', () => {
    const quote: SwapQuote = {
      discounts: [],
      quote: {
        general: {
          dstAmount: '1000000',
          provider: 'swapkit',
          tx: {
            solana: {
              data: 'serialized-tx-data',
              networkFee: 5000n,
              swapFee: { amount: 0n, decimals: 9, chain: Chain.Solana },
            },
          },
        },
      },
    }

    expect(getSwapDestinationAddress({ quote, fromCoin })).toBe('')
  })

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
