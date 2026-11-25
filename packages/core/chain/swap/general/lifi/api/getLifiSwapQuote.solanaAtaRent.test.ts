import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getQuote: vi.fn(),
  injectSolanaAtaIfMissing: vi.fn(),
  getSolanaTokenAccountRent: vi.fn(),
}))

vi.mock('@lifi/sdk', () => ({
  ChainId: {},
  createClient: () => ({ config: {}, providers: [] }),
  getQuote: mocks.getQuote,
}))
vi.mock('@vultisig/core-chain/swap/general/lifi/api/injectSolanaAtaIfMissing', () => ({
  injectSolanaAtaIfMissing: mocks.injectSolanaAtaIfMissing,
}))
vi.mock('@vultisig/core-chain/chains/solana/tokenAccountRent', () => ({
  getSolanaTokenAccountRent: mocks.getSolanaTokenAccountRent,
}))
vi.mock('./lifiSwapFees', () => ({
  getLifiEvmSwapFees: vi.fn(),
  getLifiSolanaSwapFees: () => ({}),
}))

import { Chain } from '@vultisig/core-chain/Chain'

import { getLifiSwapQuote } from './getLifiSwapQuote'

const wallet = '5QXePTiaWgmqSCHh9YDWAiVvEeKWaM5cUN62K4SXwUSB'
const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

const solToUsdc = {
  from: { chain: Chain.Solana, address: wallet },
  to: { chain: Chain.Solana, address: wallet, id: usdcMint },
  amount: 1_000_000_000n,
} as const

describe('getLifiSwapQuote — Solana token-account rent', () => {
  beforeEach(() => {
    mocks.getQuote.mockReset().mockResolvedValue({
      transactionRequest: { data: 'lifi-base64-tx' },
      estimate: { toAmount: '150000000', gasCosts: [{ amount: '12000' }], feeCosts: [] },
    })
    mocks.injectSolanaAtaIfMissing.mockReset()
    mocks.getSolanaTokenAccountRent.mockReset().mockResolvedValue(1_488_440n)
  })

  it('adds the live rent when it injects the destination token account', async () => {
    mocks.injectSolanaAtaIfMissing.mockResolvedValue({ data: 'patched-base64-tx', ataInjected: true })

    const quote = await getLifiSwapQuote(solToUsdc)

    expect(mocks.getSolanaTokenAccountRent).toHaveBeenCalledOnce()
    expect('solana' in quote.tx && quote.tx.solana).toMatchObject({
      data: 'patched-base64-tx',
      networkFee: 12_000n + 1_488_440n,
    })
  })

  it('quotes only the LI.FI gas cost and skips the rent read when the account exists', async () => {
    mocks.injectSolanaAtaIfMissing.mockResolvedValue({ data: 'lifi-base64-tx', ataInjected: false })

    const quote = await getLifiSwapQuote(solToUsdc)

    expect(mocks.getSolanaTokenAccountRent).not.toHaveBeenCalled()
    expect('solana' in quote.tx && quote.tx.solana.networkFee).toBe(12_000n)
  })
})
