import { UtxoChain } from '@vultisig/core-chain/Chain'
import { getUtxoStats } from '@vultisig/core-chain/chains/utxo/client/getUtxoStats'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getUtxoByteFee } from './byteFee'

vi.mock('@vultisig/core-config', () => ({ rootApiUrl: 'https://api.vultisig.com' }))

vi.mock('@vultisig/core-chain/chains/utxo/client/getUtxoStats', () => ({
  getUtxoStats: vi.fn(),
}))

const mockGetUtxoStats = vi.mocked(getUtxoStats)
const fetchMock = vi.fn<typeof fetch>()

const mempoolBlocksUrl = 'https://api.vultisig.com/mempool/v1/fees/mempool-blocks'

const blockchairSuggests = (byteFee: number) =>
  mockGetUtxoStats.mockResolvedValueOnce({
    data: { suggested_transaction_fee_per_byte_sat: byteFee },
  })

const mempoolReturns = (blocks: unknown) =>
  fetchMock.mockResolvedValueOnce({ ok: true, json: async () => blocks } as Response)

describe('getUtxoByteFee', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    fetchMock.mockReset()
    mockGetUtxoStats.mockReset()
  })

  it('uses the app-aligned 25% Dogecoin multiplier', async () => {
    blockchairSuggests(500_000)

    await expect(getUtxoByteFee(UtxoChain.Dogecoin)).resolves.toBe(125_000n)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    { blockchair: 2, medianFee: 2.4, expected: 3n },
    { blockchair: 2, medianFee: 0.13, expected: 3n },
    { blockchair: 2, medianFee: 4.17, expected: 6n },
    { blockchair: 1, medianFee: 0.5, expected: 2n },
    { blockchair: 2, medianFee: 3.9, expected: 5n },
    { blockchair: 40, medianFee: 10, expected: 50n },
    { blockchair: 0, medianFee: 0.5, expected: 2n },
    { blockchair: 1, medianFee: 1.6004, expected: 3n },
  ])(
    'signs Bitcoin at max(2, ceil(max(M, B) x 1.25)): B=$blockchair, M=$medianFee -> $expected',
    async ({ blockchair, medianFee, expected }) => {
      blockchairSuggests(blockchair)
      mempoolReturns([{ medianFee }, { medianFee: 1 }])

      await expect(getUtxoByteFee(UtxoChain.Bitcoin)).resolves.toBe(expected)
      expect(fetchMock).toHaveBeenCalledWith(mempoolBlocksUrl, expect.anything())
    }
  )

  it('falls back to Blockchair x2.5 when the proxy route returns 404', async () => {
    blockchairSuggests(2)
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }))

    await expect(getUtxoByteFee(UtxoChain.Bitcoin)).resolves.toBe(5n)
  })

  it.each([
    { label: 'M=0', blocks: [{ medianFee: 0 }] },
    { label: 'M=NaN', blocks: [{ medianFee: NaN }] },
    { label: 'M=6000', blocks: [{ medianFee: 6000 }] },
    { label: 'M=-1', blocks: [{ medianFee: -1 }] },
    { label: 'M=Infinity', blocks: [{ medianFee: Infinity }] },
    { label: 'M as a string', blocks: [{ medianFee: '3' }] },
    { label: 'no medianFee', blocks: [{}] },
    { label: 'no projected block', blocks: [] },
    { label: 'a non-array body', blocks: { medianFee: 3 } },
  ])('falls back to Blockchair x2.5 on $label', async ({ blocks }) => {
    blockchairSuggests(2)
    mempoolReturns(blocks)

    await expect(getUtxoByteFee(UtxoChain.Bitcoin)).resolves.toBe(5n)
  })

  it('falls back to Blockchair x2.5 when the proxy does not answer within 5 s', async () => {
    vi.useFakeTimers()
    blockchairSuggests(2)
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )

    const byteFee = getUtxoByteFee(UtxoChain.Bitcoin)
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(byteFee).resolves.toBe(5n)
  })

  it('propagates a Blockchair failure without using mempool data alone', async () => {
    mockGetUtxoStats.mockRejectedValueOnce(new Error('blockchair down'))

    await expect(getUtxoByteFee(UtxoChain.Bitcoin)).rejects.toThrow('blockchair down')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([UtxoChain.Litecoin, UtxoChain.BitcoinCash, UtxoChain.Dash])(
    'keeps Blockchair x2.5 on %s without querying mempool data',
    async chain => {
      blockchairSuggests(2)

      await expect(getUtxoByteFee(chain)).resolves.toBe(5n)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('keeps the Zcash 100 sat/byte constant', async () => {
    await expect(getUtxoByteFee(UtxoChain.Zcash)).resolves.toBe(100n)
    expect(mockGetUtxoStats).not.toHaveBeenCalled()
  })
})
