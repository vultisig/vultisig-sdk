import { Chain } from '@vultisig/core-chain/Chain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getJupiterSwapQuote } from './getJupiterSwapQuote'
import { deriveJupiterFeeAccount, prependJupiterFeeAta } from './jupiterFeeAta'

vi.mock('./jupiterFeeAta', () => ({
  deriveJupiterFeeAccount: vi.fn(),
  prependJupiterFeeAta: vi.fn(),
}))

const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const feeOwner = '8iqhrtBzMcYLR6c6FkzeoMHibedYDkHvLKnX2ArNie5z'
const feeAccount = 'FeeAtaAddr1111111111111111111111111111111111'

const solNative = {
  chain: Chain.Solana,
  address: 'SoLAddrSender1111111111111111111111111111111',
  decimals: 9,
  ticker: 'SOL',
} as const

const solUsdc = {
  chain: Chain.Solana,
  address: 'SoLAddrSender1111111111111111111111111111111',
  id: usdcMint,
  decimals: 6,
  ticker: 'USDC',
} as const

const jsonResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as unknown as Response

type FetchCall = { url: string; init?: RequestInit }

describe('getJupiterSwapQuote', () => {
  let calls: FetchCall[]

  beforeEach(() => {
    calls = []
    vi.mocked(deriveJupiterFeeAccount)
      .mockReset()
      .mockResolvedValue({
        feeAccount,
        tokenProgramId: {} as never,
        mintPubkey: {} as never,
        ownerPubkey: {} as never,
      })
    vi.mocked(prependJupiterFeeAta).mockReset().mockResolvedValue('prepended-base64-tx')

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/swap/v1/quote')) {
          return Promise.resolve(
            jsonResponse({
              inputMint: 'So11111111111111111111111111111111111111112',
              inAmount: '1000000000',
              outputMint: usdcMint,
              outAmount: '1000000',
              platformFee: { amount: '5000', feeBps: 50 },
            })
          )
        }
        return Promise.resolve(jsonResponse({ swapTransaction: 'raw-base64-tx' }))
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends platformFeeBps on the quote and feeAccount on the swap when a fee is charged', async () => {
    const quote = await getJupiterSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n, affiliateBps: 50 })

    const quoteCall = calls.find(c => c.url.includes('/swap/v1/quote'))!
    expect(quoteCall.url).toContain('swapMode=ExactIn')
    expect(quoteCall.url).toContain('platformFeeBps=50')
    expect(quoteCall.url).toContain(`outputMint=${usdcMint}`)

    expect(deriveJupiterFeeAccount).toHaveBeenCalledWith({ outputMint: usdcMint, feeOwner })

    const swapCall = calls.find(c => c.url.includes('/swap/v1/swap'))!
    expect(JSON.parse(swapCall.init!.body as string)).toMatchObject({
      userPublicKey: solNative.address,
      feeAccount,
    })

    expect(prependJupiterFeeAta).toHaveBeenCalledOnce()
    expect(quote.provider).toBe('jupiter')
    expect(quote.dstAmount).toBe('1000000')
    expect('solana' in quote.tx && quote.tx.solana.data).toBe('prepended-base64-tx')
  })

  it('omits the platform fee entirely when affiliateBps is 0', async () => {
    const quote = await getJupiterSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n, affiliateBps: 0 })

    const quoteCall = calls.find(c => c.url.includes('/swap/v1/quote'))!
    expect(quoteCall.url).not.toContain('platformFeeBps')

    expect(deriveJupiterFeeAccount).not.toHaveBeenCalled()
    expect(prependJupiterFeeAta).not.toHaveBeenCalled()

    const swapCall = calls.find(c => c.url.includes('/swap/v1/swap'))!
    expect(JSON.parse(swapCall.init!.body as string)).not.toHaveProperty('feeAccount')

    // Untouched Jupiter transaction flows through verbatim.
    expect('solana' in quote.tx && quote.tx.solana.data).toBe('raw-base64-tx')
  })

  it('skips the fee account when Jupiter floors the platform fee to zero', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url.includes('/swap/v1/quote')) {
          return Promise.resolve(
            jsonResponse({
              inputMint: 'So11111111111111111111111111111111111111112',
              inAmount: '1000000000',
              outputMint: usdcMint,
              outAmount: '1000000',
              // Fee requested (platformFeeBps sent), but the quoted amount floors to 0.
              platformFee: { amount: '0', feeBps: 50 },
            })
          )
        }
        return Promise.resolve(jsonResponse({ swapTransaction: 'raw-base64-tx' }))
      })
    )

    const quote = await getJupiterSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n, affiliateBps: 50 })

    // The fee was still requested on the quote...
    const quoteCall = calls.find(c => c.url.includes('/swap/v1/quote'))!
    expect(quoteCall.url).toContain('platformFeeBps=50')

    // ...but with a zero quoted fee no fee account is derived, prepended, or sent.
    expect(deriveJupiterFeeAccount).not.toHaveBeenCalled()
    expect(prependJupiterFeeAta).not.toHaveBeenCalled()

    const swapCall = calls.find(c => c.url.includes('/swap/v1/swap'))!
    expect(JSON.parse(swapCall.init!.body as string)).not.toHaveProperty('feeAccount')

    // Untouched Jupiter transaction flows through verbatim and the swap fee is 0.
    expect('solana' in quote.tx && quote.tx.solana.data).toBe('raw-base64-tx')
    expect('solana' in quote.tx && quote.tx.solana.swapFee.amount).toBe(0n)
  })

  it('throws when Jupiter returns no serialized transaction', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/swap/v1/quote')) {
          return Promise.resolve(jsonResponse({ outAmount: '1000000', outputMint: usdcMint }))
        }
        return Promise.resolve(jsonResponse({}))
      })
    )

    await expect(
      getJupiterSwapQuote({ from: solNative, to: solUsdc, amount: 1_000_000_000n, affiliateBps: 50 })
    ).rejects.toThrow(/did not include a serialized transaction/)
  })
})
