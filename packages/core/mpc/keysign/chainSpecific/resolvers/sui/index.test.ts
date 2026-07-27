import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockListCoins, mockGetReferenceGasPrice, mockGetKeysignCoin } = vi.hoisted(() => ({
  mockListCoins: vi.fn(),
  mockGetReferenceGasPrice: vi.fn(async () => ({ referenceGasPrice: '1000' })),
  mockGetKeysignCoin: vi.fn(() => ({ address: '0xsender', id: undefined }) as { address: string; id?: string }),
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
  getKeysignCoin: mockGetKeysignCoin,
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
const makeCoin = (i: number, balance = '1', coinType = suiType) => ({
  objectId: `0xobj${i}`,
  version: `${i}`,
  digest: `dig${i}`,
  type: `0x2::coin::Coin<${coinType}>`,
  balance,
  owner: { $kind: 'AddressOwner', AddressOwner: '0xsender' },
})

const payload = {
  signData: { case: 'other' },
  toAddress: '0xdest',
  toAmount: '1',
} as unknown as Parameters<typeof getSuiChainSpecific>[0]['keysignPayload']

describe('getSuiChainSpecific — listCoins pagination', () => {
  beforeEach(() => mockGetKeysignCoin.mockReturnValue({ address: '0xsender', id: undefined }))

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

// `listCoins` is scoped to ONE coin type, unlike the retired `getAllCoins` sweep, so a
// token send has to ask for two sets. Getting this wrong is not a visible error: it
// yields an empty `inputCoins` (nothing to send) or a missing gas object.
describe('getSuiChainSpecific — non-native token sends need two coin listings', () => {
  const tokenType = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'

  const pageFor = (coinType: string) => {
    if (coinType === suiType) {
      return { objects: [makeCoin(0, '3000001')], hasNextPage: false, cursor: null }
    }
    return { objects: [makeCoin(1, '5000000', tokenType)], hasNextPage: false, cursor: null }
  }

  it('lists the native SUI objects (for gas) AND the sent token type', async () => {
    mockGetKeysignCoin.mockReturnValue({ address: '0xsender', id: tokenType })
    mockListCoins.mockReset().mockImplementation(async ({ coinType }: { coinType: string }) => pageFor(coinType))

    const res = await getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(mockListCoins).toHaveBeenCalledTimes(2)
    expect(mockListCoins.mock.calls.map(([req]) => req.coinType).sort()).toEqual([tokenType, suiType].sort())

    // The token object funds the transfer; the native object is carried as the gas
    // candidate. Both must survive into the payload.
    const byType = res.coins.map(c => c.coinType)
    expect(byType).toContain(tokenType)
    expect(byType).toContain(suiType)
  })

  it('does not list SUI twice when the payload names SUI as its token id', async () => {
    // A second listing would put every native object into the selection pool twice.
    //
    // Scope note: `selectSuiPayloadCoins` ALREADY emits this object twice for this
    // payload shape (once as the selected "token", once as a gas candidate) because
    // `isNativeToken` is `!coin.id` while the coin-type filter resolves to SUI. That
    // is pre-existing selection behaviour, unchanged by this transport migration and
    // not reachable from `getKeysignCoin` in practice (it leaves `id` empty for
    // native sends), so it is deliberately not touched here. What this test pins is
    // the part this change owns: exactly ONE network listing.
    mockGetKeysignCoin.mockReturnValue({ address: '0xsender', id: suiType })
    mockListCoins.mockReset().mockResolvedValue(pageFor(suiType))

    const res = await getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(mockListCoins).toHaveBeenCalledTimes(1)
    expect(mockListCoins.mock.calls[0]?.[0]).toMatchObject({ coinType: suiType })
    // Only the one object that was actually listed appears — no phantom second fetch.
    expect(new Set(res.coins.map(c => c.coinObjectId))).toEqual(new Set(['0xobj0']))
  })

  it('does not list SUI twice for a non-canonical spelling of the native type', async () => {
    // `0x2::sui::SUI` and its zero-padded form are the same coin type; comparison must
    // normalize, or the padded spelling silently duplicates the native set.
    const padded = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI'
    mockGetKeysignCoin.mockReturnValue({ address: '0xsender', id: padded })
    mockListCoins.mockReset().mockResolvedValue(pageFor(suiType))

    await getSuiChainSpecific({ keysignPayload: payload, walletCore: {} as never })

    expect(mockListCoins).toHaveBeenCalledTimes(1)
  })
})
