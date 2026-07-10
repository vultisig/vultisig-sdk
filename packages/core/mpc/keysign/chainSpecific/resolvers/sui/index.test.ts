import { describe, expect, it, vi } from 'vitest'

const { mockGetAllCoins, mockGetReferenceGasPrice } = vi.hoisted(() => ({
  mockGetAllCoins: vi.fn(),
  mockGetReferenceGasPrice: vi.fn(async () => 1000n),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({
    getAllCoins: mockGetAllCoins,
    getReferenceGasPrice: mockGetReferenceGasPrice,
  }),
}))
vi.mock('@vultisig/core-chain/chains/sui/config', () => ({
  suiGasBudget: 3_000_000n,
}))
vi.mock('../../../utils/getKeysignCoin', () => ({
  getKeysignCoin: () => ({ address: '0xsender', id: undefined }),
}))
// Force the fallback branch so the resolver returns the raw chainSpecific
// (with every paginated coin) rather than a walletCore-refined payload.
vi.mock('./refine', () => ({
  refineSuiChainSpecific: async () => {
    throw new Error('skip refine in test')
  },
}))

import { getSuiChainSpecific } from './index'

const suiType = '0x2::sui::SUI'
const makeCoin = (i: number, balance = '1') => ({
  coinType: suiType,
  coinObjectId: `0xobj${i}`,
  version: `${i}`,
  digest: `dig${i}`,
  balance,
  previousTransaction: `tx${i}`,
})

const payload = {
  signData: { case: 'other' },
  toAddress: '0xdest',
  toAmount: '1',
} as unknown as Parameters<typeof getSuiChainSpecific>[0]['keysignPayload']

describe('getSuiChainSpecific — getAllCoins pagination', () => {
  it('follows nextCursor across pages so the full coin set feeds gas/input selection', async () => {
    // Three pages of 50, 50, 7 — the pre-fix code read only the first page.
    mockGetAllCoins
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => makeCoin(i)),
        hasNextPage: true,
        nextCursor: 'cur1',
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => makeCoin(50 + i)),
        hasNextPage: true,
        nextCursor: 'cur2',
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: 7 }, (_, i) => makeCoin(100 + i)),
        hasNextPage: false,
        nextCursor: null,
      })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(mockGetAllCoins).toHaveBeenCalledTimes(3)
    expect(res.coins).toHaveLength(107)
    // Cursor from each page is threaded into the next request.
    expect(mockGetAllCoins.mock.calls[1]?.[0]).toMatchObject({
      cursor: 'cur1',
    })
    expect(mockGetAllCoins.mock.calls[2]?.[0]).toMatchObject({
      cursor: 'cur2',
    })
  })

  it('fails closed (throws, no infinite loop) when the RPC cursor never advances', async () => {
    // A misbehaving RPC that keeps claiming hasNextPage=true with a stuck cursor
    // must not spin forever — the resolver caps the loop and throws.
    mockGetAllCoins.mockReset()
    mockGetAllCoins.mockResolvedValue({
      data: [makeCoin(0)],
      hasNextPage: true,
      nextCursor: 'stuck-cursor',
    })

    await expect(getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })).rejects.toThrow(
      /exceeded \d+ pages/
    )
    // Bounded, not unbounded: called exactly the cap number of times.
    expect(mockGetAllCoins).toHaveBeenCalledTimes(200)
  })

  it('terminates on a single page (hasNextPage false)', async () => {
    mockGetAllCoins.mockReset()
    mockGetAllCoins.mockResolvedValueOnce({
      data: [makeCoin(0), makeCoin(1)],
      hasNextPage: false,
      nextCursor: null,
    })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(mockGetAllCoins).toHaveBeenCalledTimes(1)
    expect(res.coins).toHaveLength(2)
  })

  it('bounds a dusty native wallet payload to the largest covering object', async () => {
    mockGetAllCoins.mockReset()
    mockGetAllCoins.mockResolvedValueOnce({
      data: [makeCoin(0, '3000001'), ...Array.from({ length: 799 }, (_, i) => makeCoin(i + 1, '1'))],
      hasNextPage: false,
      nextCursor: null,
    })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(res.coins.map(c => c.coinObjectId)).toEqual(['0xobj0'])
  })
})
