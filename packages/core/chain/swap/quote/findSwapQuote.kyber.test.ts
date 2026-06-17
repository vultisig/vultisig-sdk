import { Chain } from '@vultisig/core-chain/Chain'
import { getSwapAffiliateBps } from '@vultisig/core-chain/swap/affiliate'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { describe, expect, it, vi } from 'vitest'

import { findSwapQuote } from './findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/kyber/api/quote', () => ({
  getKyberSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote', () => ({
  getOneInchSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote', () => ({
  getLifiSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote', () => ({
  getSwapKitQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: vi.fn().mockResolvedValue(null),
}))

// Keep the proactive THORChain minimum hermetic — no live inbound_addresses /
// pool fetches in unit tests. `null` = "no proactive signal" (#604).
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: vi.fn().mockResolvedValue(null),
}))

describe('findSwapQuote Kyber affiliate fee', () => {
  it('passes effective affiliate BPS after VULT discount', async () => {
    const expectedBps = getSwapAffiliateBps('gold')
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))

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
      affiliateBps: expectedBps,
    })
    expect(quote.discounts).toEqual([{ vult: { tier: 'gold' } }])
  })
})
