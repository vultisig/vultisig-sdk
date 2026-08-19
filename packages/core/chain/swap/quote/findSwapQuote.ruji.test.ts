import { Chain } from '@vultisig/core-chain/Chain'
import { AccountCoin } from '@vultisig/core-chain/coin/AccountCoin'
import { GeneralSwapQuote } from '@vultisig/core-chain/swap/general/GeneralSwapQuote'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRujiTradeSwapQuote: vi.fn(),
  getNativeSwapQuote: vi.fn(),
  getNativeSwapMinAmountIn: vi.fn(),
  getNativeSwapTradingHalt: vi.fn(),
}))

vi.mock('@vultisig/core-chain/swap/general/ruji/api/getRujiTradeSwapQuote', async importOriginal => ({
  ...(await importOriginal<typeof import('@vultisig/core-chain/swap/general/ruji/api/getRujiTradeSwapQuote')>()),
  getRujiTradeSwapQuote: mocks.getRujiTradeSwapQuote,
}))
vi.mock('@vultisig/core-chain/swap/native/api/getNativeSwapQuote', () => ({
  getNativeSwapQuote: mocks.getNativeSwapQuote,
}))
vi.mock('@vultisig/core-chain/swap/native/minimum/getNativeSwapMinAmountIn', () => ({
  getNativeSwapMinAmountIn: mocks.getNativeSwapMinAmountIn,
}))
vi.mock('@vultisig/core-chain/swap/native/halts/getNativeSwapTradingHalt', () => ({
  getNativeSwapTradingHalt: mocks.getNativeSwapTradingHalt,
}))

import { findSwapQuotes } from './findSwapQuote'

const address = 'thor1vk6trmz42cjrh4zcxczeaacnsv3snv4f22x8ccu203dqde7vtaxsyevlec'
const rune: AccountCoin = {
  chain: Chain.THORChain,
  address,
  ticker: 'RUNE',
  decimals: 8,
}
const brune: AccountCoin = {
  chain: Chain.THORChain,
  address,
  id: 'x/brune',
  ticker: 'bRUNE',
  decimals: 8,
}

const quoteFor = (from: AccountCoin): GeneralSwapQuote => ({
  provider: 'ruji',
  dstAmount: '998124',
  expiresAt: Date.now() + 120_000,
  tx: {
    cosmosWasm: {
      sender: from.address,
      contract: address,
      executeMsg: JSON.stringify({ swap: { min: { min_return: '988142', to: address } } }),
      funds: [{ denom: from.id === 'x/brune' ? 'x/brune' : 'rune', amount: '1000000' }],
    },
  },
})

describe('findSwapQuotes RUJI Trade routing', () => {
  beforeEach(() => {
    mocks.getRujiTradeSwapQuote.mockReset()
    mocks.getNativeSwapQuote.mockReset().mockRejectedValue(new Error('pool does not exist'))
    mocks.getNativeSwapMinAmountIn.mockReset().mockResolvedValue(null)
    mocks.getNativeSwapTradingHalt.mockReset().mockResolvedValue(null)
  })

  it.each([
    { label: 'RUNE → bRUNE', from: rune, to: brune },
    { label: 'bRUNE → RUNE', from: brune, to: rune },
  ])('registers RUJI Trade in the normal quote flow for $label', async ({ from, to }) => {
    mocks.getRujiTradeSwapQuote.mockResolvedValueOnce(quoteFor(from))

    const result = await findSwapQuotes({
      from,
      to,
      amount: 1_000_000n,
      slippageTolerance: 1.25,
      excludeProviders: ['SwapKit'],
    })

    expect(result.ranked).toHaveLength(1)
    expect(result.ranked[0].providerName).toBe('RUJI Trade')
    expect(result.best.quote).toHaveProperty('general.provider', 'ruji')
    expect(mocks.getRujiTradeSwapQuote).toHaveBeenCalledWith({
      from,
      to,
      amount: 1_000_000n,
      destination: address,
      slippageBps: 125,
    })
  })

  it('forwards an explicit THORChain recipient because the FIN execute message supports it', async () => {
    mocks.getRujiTradeSwapQuote.mockResolvedValueOnce(quoteFor(rune))

    await findSwapQuotes({
      from: rune,
      to: brune,
      amount: 1_000_000n,
      recipient: address,
      excludeProviders: ['SwapKit'],
    })

    expect(mocks.getRujiTradeSwapQuote).toHaveBeenCalledWith(expect.objectContaining({ destination: address }))
  })
})
