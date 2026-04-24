import { Chain } from '@vultisig/core-chain/Chain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { coreFindSwapQuote } = vi.hoisted(() => ({
  coreFindSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/quote/findSwapQuote', () => ({
  findSwapQuote: coreFindSwapQuote,
}))

import { findSwapQuote as coreFindSwapQuoteImport } from '@vultisig/core-chain/swap/quote/findSwapQuote'

import { findSwapQuote } from '../../../../src/tools/swap/findSwapQuote'

const core = vi.mocked(coreFindSwapQuoteImport)

describe('findSwapQuote (tools/swap)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps from/to AccountCoin fields and passes amount, referral, vultDiscountTier to core', async () => {
    core.mockResolvedValue({} as Awaited<ReturnType<typeof findSwapQuote>>)

    await findSwapQuote({
      fromChain: Chain.Ethereum,
      fromAddress: '0xfrom',
      fromSymbol: 'ETH',
      fromDecimals: 18,
      fromTokenId: '0xerc20',
      toChain: Chain.Bitcoin,
      toAddress: 'bc1qto',
      toSymbol: 'BTC',
      toDecimals: 8,
      toTokenId: 'rune:xyz',
      amount: 10_000_000_000_000_000_000n,
      referral: 'ref-code',
      vultDiscountTier: 'gold',
    })

    expect(core).toHaveBeenCalledWith({
      from: {
        chain: Chain.Ethereum,
        address: '0xfrom',
        ticker: 'ETH',
        decimals: 18,
        id: '0xerc20',
      },
      to: {
        chain: Chain.Bitcoin,
        address: 'bc1qto',
        ticker: 'BTC',
        decimals: 8,
        id: 'rune:xyz',
      },
      amount: 10_000_000_000_000_000_000n,
      referral: 'ref-code',
      vultDiscountTier: 'gold',
    })
  })

  it('propagates rejection from core findSwapQuote', async () => {
    core.mockRejectedValue(new Error('no routes'))

    await expect(
      findSwapQuote({
        fromChain: Chain.Ethereum,
        fromAddress: '0xa',
        fromSymbol: 'ETH',
        fromDecimals: 18,
        toChain: Chain.Bitcoin,
        toAddress: 'bc1q',
        toSymbol: 'BTC',
        toDecimals: 8,
        amount: 1n,
      })
    ).rejects.toThrow('no routes')
  })

  it('is valid with referral and token ids omitted', async () => {
    core.mockResolvedValue({} as Awaited<ReturnType<typeof findSwapQuote>>)

    await findSwapQuote({
      fromChain: Chain.Ethereum,
      fromAddress: '0xa',
      fromSymbol: 'ETH',
      fromDecimals: 18,
      toChain: Chain.Bitcoin,
      toAddress: 'bc1q',
      toSymbol: 'BTC',
      toDecimals: 8,
      amount: 1n,
    })

    expect(core).toHaveBeenCalledWith({
      from: {
        chain: Chain.Ethereum,
        address: '0xa',
        ticker: 'ETH',
        decimals: 18,
        id: undefined,
      },
      to: {
        chain: Chain.Bitcoin,
        address: 'bc1q',
        ticker: 'BTC',
        decimals: 8,
        id: undefined,
      },
      amount: 1n,
      referral: undefined,
      vultDiscountTier: undefined,
    })
  })
})
