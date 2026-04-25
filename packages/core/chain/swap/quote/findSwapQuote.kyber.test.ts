import { Chain } from '@vultisig/core-chain/Chain'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))

describe('findSwapQuote Kyber affiliate fee', () => {
  it('passes effective affiliate BPS after VULT discount', async () => {
    vi.mocked(getKyberSwapQuote).mockResolvedValue({
      dstAmount: '10000000',
      provider: 'kyber',
      tx: {
        evm: {
          from: '0xsender',
          to: '0xrouter',
          data: '0xswap',
          value: '0',
        },
      },
    })

    const from = {
      chain: Chain.Ethereum,
      address: '0xsender',
      id: '0xsrc',
      decimals: 18,
      ticker: 'SRC',
    }
    const to = {
      chain: Chain.Ethereum,
      address: '0xsender',
      id: '0xdst',
      decimals: 6,
      ticker: 'DST',
    }

    const quote = await findSwapQuote({
      from,
      to,
      amount: 1_000_000n,
      vultDiscountTier: 'gold',
    })

    expect(getKyberSwapQuote).toHaveBeenCalledWith({
      from,
      to,
      amount: 1_000_000n,
      affiliateBps: 30,
    })
    expect(quote.discounts).toEqual([{ vult: { tier: 'gold' } }])
  })
})
