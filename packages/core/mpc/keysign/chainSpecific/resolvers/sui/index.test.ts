import { describe, expect, it, vi } from 'vitest'

const { mockListCoins, mockGetReferenceGasPrice } = vi.hoisted(() => ({
  mockListCoins: vi.fn(),
  mockGetReferenceGasPrice: vi.fn(async () => ({ referenceGasPrice: '1000' })),
}))

vi.mock('@vultisig/core-chain/chains/sui/client', () => ({
  getSuiClient: () => ({
    listCoins: mockListCoins,
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
// The unified client returns coin OBJECTS: `objectId` plus the full `Coin<...>`
// wrapper type, not JSON-RPC's `coinObjectId` plus the inner `coinType`.
const makeCoin = (i: number, balance = '1') => ({
  objectId: `0xobj${i}`,
  version: `${i}`,
  digest: `dig${i}`,
  type: `0x2::coin::Coin<${suiType}>`,
  balance,
  owner: { $kind: 'AddressOwner', AddressOwner: '0xsender' },
})

const payload = {
  signData: { case: 'other' },
  toAddress: '0xdest',
  toAmount: '1',
} as unknown as Parameters<typeof getSuiChainSpecific>[0]['keysignPayload']

describe('getSuiChainSpecific — listCoins pagination', () => {
  it('follows the cursor across pages so the full coin set feeds gas/input selection', async () => {
    // Three pages of 50, 50, 7 — a single-page read silently truncates the set.
    mockListCoins
      .mockReset()
      .mockResolvedValueOnce({
        objects: Array.from({ length: 50 }, (_, i) => makeCoin(i)),
        hasNextPage: true,
        cursor: 'cur1',
      })
      .mockResolvedValueOnce({
        objects: Array.from({ length: 50 }, (_, i) => makeCoin(50 + i)),
        hasNextPage: true,
        cursor: 'cur2',
      })
      .mockResolvedValueOnce({
        objects: [makeCoin(100, '3000001'), ...Array.from({ length: 6 }, (_, i) => makeCoin(101 + i))],
        hasNextPage: false,
        cursor: null,
      })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(mockListCoins).toHaveBeenCalledTimes(3)
    expect(res.coins.map(coin => coin.coinObjectId)).toEqual(['0xobj100'])
    // The wrapper type is unwrapped back to the inner coin type the payload stores,
    // which is what every downstream coin-type comparison matches against.
    expect(res.coins.map(coin => coin.coinType)).toEqual([suiType])
    // Cursor from each page is threaded into the next request.
    expect(mockListCoins.mock.calls[1]?.[0]).toMatchObject({ cursor: 'cur1' })
    expect(mockListCoins.mock.calls[2]?.[0]).toMatchObject({ cursor: 'cur2' })
  })

  it('scopes the native listing to the SUI coin type', async () => {
    // `listCoins` returns ONE coin type per call (SUI by default) where JSON-RPC's
    // getAllCoins returned every type — the request must name the type explicitly.
    mockListCoins.mockReset().mockResolvedValueOnce({
      objects: [makeCoin(0, '3000001')],
      hasNextPage: false,
      cursor: null,
    })

    await getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(mockListCoins).toHaveBeenCalledTimes(1)
    expect(mockListCoins.mock.calls[0]?.[0]).toMatchObject({ owner: '0xsender', coinType: suiType })
  })

  it('reads the reference gas price out of its response envelope', async () => {
    mockListCoins.mockReset().mockResolvedValueOnce({
      objects: [makeCoin(0, '3000001')],
      hasNextPage: false,
      cursor: null,
    })

    const res = await getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    // `{ referenceGasPrice }`, not a bare bigint — stringifying the envelope
    // itself would put '[object Object]' into the signed payload.
    expect(res.referenceGasPrice).toBe('1000')
  })

  it('fails closed (throws, no infinite loop) when the cursor never advances', async () => {
    mockListCoins.mockReset()
    mockListCoins.mockResolvedValue({
      objects: [makeCoin(0)],
      hasNextPage: true,
      cursor: 'stuck-cursor',
    })

    await expect(getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })).rejects.toThrow(
      /exceeded \d+ pages/
    )
    // Bounded, not unbounded: called exactly the cap number of times.
    expect(mockListCoins).toHaveBeenCalledTimes(200)
  })

  it('terminates on a single page (hasNextPage false)', async () => {
    mockListCoins.mockReset()
    mockListCoins.mockResolvedValueOnce({
      objects: [makeCoin(0, '3000001'), makeCoin(1)],
      hasNextPage: false,
      cursor: null,
    })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(mockListCoins).toHaveBeenCalledTimes(1)
    expect(res.coins.map(coin => coin.coinObjectId)).toEqual(['0xobj0'])
  })

  it('bounds a dusty native wallet payload to the largest covering object', async () => {
    mockListCoins.mockReset()
    mockListCoins.mockResolvedValueOnce({
      objects: [makeCoin(0, '3000001'), ...Array.from({ length: 799 }, (_, i) => makeCoin(i + 1, '1'))],
      hasNextPage: false,
      cursor: null,
    })

    const res = await getSuiChainSpecific({
      keysignPayload: payload,
      walletCore: {} as never,
    })

    expect(res.coins.map(c => c.coinObjectId)).toEqual(['0xobj0'])
  })
})
