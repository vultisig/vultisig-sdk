import { Chain } from '@vultisig/core-chain/Chain'
import { getCowSwapQuote } from '@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote'
import type { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { getKyberSwapQuote } from '@vultisig/core-chain/swap/general/kyber/api/quote'
import { getLifiSwapQuote } from '@vultisig/core-chain/swap/general/lifi/api/getLifiSwapQuote'
import { getOneInchSwapQuote } from '@vultisig/core-chain/swap/general/oneInch/api/getOneInchSwapQuote'
import { getSwapKitQuote } from '@vultisig/core-chain/swap/general/swapkit/api/getSwapKitQuote'
import { getNativeSwapQuote } from '@vultisig/core-chain/swap/native/api/getNativeSwapQuote'
import { NativeSwapQuote } from '@vultisig/core-chain/swap/native/NativeSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { aggregatorPreferenceOrder, findSwapQuote } from '../findSwapQuote'

vi.mock('@vultisig/core-chain/swap/general/cowswap/api/getCowSwapQuote', () => ({
  getCowSwapQuote: vi.fn(),
}))
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

const evmEthCoins = {
  from: {
    chain: Chain.Ethereum,
    address: '0xsender',
    id: '0xweth',
    decimals: 18,
    ticker: 'WETH',
  },
  to: {
    chain: Chain.Ethereum,
    address: '0xsender',
    id: '0xusdc',
    decimals: 6,
    ticker: 'USDC',
  },
} as const

function cowswapQuote(dstAmount: string): GeneralSwapQuote {
  return {
    dstAmount,
    provider: 'cowswap',
    tx: {
      cowswap_order: {
        sellToken: '0xweth',
        buyToken: '0xusdc',
        receiver: '0xreceiver',
        sellAmount: '1000000000000000000',
        buyAmount: dstAmount,
        validTo: Math.floor(Date.now() / 1000) + 900,
        appData: '{}',
        appDataHash: '0xdeadbeef',
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
        chainId: 1,
        apiBase: 'https://api.cow.fi/mainnet',
      },
    },
  }
}

function kyberQuote(dstAmount: string): GeneralSwapQuote {
  return {
    dstAmount,
    provider: 'kyber',
    tx: {
      evm: {
        from: '0xsender',
        to: '0xrouter',
        data: '0x',
        value: '0',
      },
    },
  }
}

function minimalNativeQuote(swapChain: Chain, expected_amount_out: string): NativeSwapQuote {
  return {
    swapChain: swapChain as NativeSwapQuote['swapChain'],
    expected_amount_out,
    expiry: 0,
    fees: { affiliate: '0', asset: '0', outbound: '0', total: '0' },
    memo: '',
    notes: '',
    outbound_delay_blocks: 0,
    outbound_delay_seconds: 0,
    recommended_min_amount_in: '0',
    warning: '',
  }
}

describe('CowSwap in aggregatorPreferenceOrder', () => {
  it('CowSwap appears before KyberSwap in declared preference order', () => {
    const cowIdx = aggregatorPreferenceOrder.indexOf('CowSwap')
    const kyberIdx = aggregatorPreferenceOrder.indexOf('KyberSwap')
    expect(cowIdx).toBeGreaterThanOrEqual(0)
    expect(cowIdx).toBeLessThan(kyberIdx)
  })
})

describe('findSwapQuote CowSwap selection', () => {
  beforeEach(() => {
    vi.mocked(getCowSwapQuote).mockReset()
    vi.mocked(getKyberSwapQuote).mockReset()
    vi.mocked(getOneInchSwapQuote).mockReset()
    vi.mocked(getLifiSwapQuote).mockReset()
    vi.mocked(getSwapKitQuote).mockReset()
    vi.mocked(getNativeSwapQuote).mockReset()

    // Default: all other providers fail
    vi.mocked(getKyberSwapQuote).mockRejectedValue(new Error('skip kyber'))
    vi.mocked(getOneInchSwapQuote).mockRejectedValue(new Error('skip inch'))
    vi.mocked(getLifiSwapQuote).mockRejectedValue(new Error('skip lifi'))
    vi.mocked(getSwapKitQuote).mockRejectedValue(new Error('skip swapkit'))
    vi.mocked(getNativeSwapQuote).mockRejectedValue(new Error('skip native'))
  })

  it('returns a cowswap_order quote when CowSwap is the only succeeding provider', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(cowswapQuote('990000000'))

    const quote = await findSwapQuote({ ...evmEthCoins, amount: 1_000_000_000_000_000_000n })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) throw new Error('Expected general')
    expect(quote.quote.general.provider).toBe('cowswap')
    expect('cowswap_order' in quote.quote.general.tx).toBe(true)
  })

  it('CowSwap beats KyberSwap on equal output (CowSwap has higher preference)', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(cowswapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(kyberQuote('1000000'))

    const quote = await findSwapQuote({ ...evmEthCoins, amount: 1_000_000_000_000_000_000n })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) throw new Error('Expected general')
    expect(quote.quote.general.provider).toBe('cowswap')
  })

  it('KyberSwap beats CowSwap when it returns higher output', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(cowswapQuote('1000000'))
    vi.mocked(getKyberSwapQuote).mockResolvedValue(kyberQuote('2000000'))

    const quote = await findSwapQuote({ ...evmEthCoins, amount: 1_000_000_000_000_000_000n })

    expect('general' in quote.quote).toBe(true)
    if (!('general' in quote.quote)) throw new Error('Expected general')
    expect(quote.quote.general.provider).toBe('kyber')
  })

  it('THORChain hard priority beats CowSwap regardless of output', async () => {
    vi.mocked(getCowSwapQuote).mockResolvedValue(cowswapQuote('999999999'))
    vi.mocked(getNativeSwapQuote).mockImplementation(async ({ swapChain }) =>
      // comparably tiny native amount
      minimalNativeQuote(swapChain, '100')
    )

    const quote = await findSwapQuote({ ...evmEthCoins, amount: 1_000_000_000_000_000_000n })

    expect('native' in quote.quote).toBe(true)
  })

  it('when CowSwap and all others fail, error message includes CowSwap', async () => {
    vi.mocked(getCowSwapQuote).mockRejectedValue(new Error('cowswap unavailable'))

    await expect(findSwapQuote({ ...evmEthCoins, amount: 1_000_000_000_000_000_000n })).rejects.toThrow('CowSwap')
  })

  it('does not query CowSwap for non-EVM chains', async () => {
    const btcToEth = {
      from: {
        chain: Chain.Bitcoin,
        address: 'bc1qsource',
        decimals: 8,
        ticker: 'BTC',
      },
      to: {
        chain: Chain.Ethereum,
        address: '0xdst',
        id: '0xweth',
        decimals: 18,
        ticker: 'WETH',
      },
    }

    vi.mocked(getSwapKitQuote).mockResolvedValue({
      dstAmount: '1000000',
      provider: 'swapkit',
      tx: {
        transfer: { to: '0xdeposit', amount: 1n },
      },
    })

    await findSwapQuote({ ...btcToEth, amount: 10_000n })

    expect(getCowSwapQuote).not.toHaveBeenCalled()
  })

  it('does not query CowSwap for cross-chain EVM pairs', async () => {
    const ethToArb = {
      from: {
        chain: Chain.Ethereum,
        address: '0xsender',
        id: '0xweth',
        decimals: 18,
        ticker: 'WETH',
      },
      to: {
        chain: Chain.Arbitrum,
        address: '0xdst',
        id: '0xarb',
        decimals: 18,
        ticker: 'ARB',
      },
    }

    vi.mocked(getLifiSwapQuote).mockResolvedValue({
      dstAmount: '1000',
      provider: 'li.fi',
      tx: {
        evm: { from: '0xsender', to: '0xrouter', data: '0x', value: '0' },
      },
    })

    await findSwapQuote({ ...ethToArb, amount: 1_000_000_000_000_000_000n })

    expect(getCowSwapQuote).not.toHaveBeenCalled()
  })
})
